import type { CompileDiagnostic, FirmwareSymbol, LineEntry, ValueType } from "@linelab/schema";

const base = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** gcc/clang diagnostics ("file:line:col: error: message") from a compiler log. */
export function parseGccDiagnostics(log: string): CompileDiagnostic[] {
  const out: CompileDiagnostic[] = [];
  const seen = new Set<string>();
  for (const raw of log.split(/\r?\n/)) {
    const m = /^(.+?):(\d+):(?:(\d+):)? (fatal error|error|warning|note): (.*)$/.exec(raw.trim());
    if (!m) continue;
    const [, file = "", line = "0", col = "0", sev = "error", message = ""] = m;
    const d: CompileDiagnostic = {
      file: base(file),
      line: Number(line),
      column: Number(col),
      severity: sev === "fatal error" ? "error" : (sev as CompileDiagnostic["severity"]),
      message,
    };
    const key = `${d.file}:${d.line}:${d.column}:${d.severity}:${d.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(d);
    }
  }
  return out;
}

/** Rows of `objdump --dwarf=decodedline` (also `llvm-dwarfdump --debug-line`-style tables). */
export function parseDecodedLines(text: string): LineEntry[] {
  const rows = new Map<number, LineEntry>();
  for (const raw of text.split(/\r?\n/)) {
    const m = /^(\S+)\s+(\d+)\s+(0x[0-9a-fA-F]+)/.exec(raw.trim());
    if (!m) continue;
    const [, file = "", line = "0", addr = "0"] = m;
    const address = Number.parseInt(addr, 16);
    if (Number(line) === 0) continue;
    // Keep the first row per address (later rows at the same address are view markers).
    if (!rows.has(address)) rows.set(address, { address, file: base(file), line: Number(line) });
  }
  return [...rows.values()].sort((a, b) => a.address - b.address);
}

/** AVR data addresses are offset by 0x800000 in the ELF; SRAM offsets are what the CPU sees. */
const AVR_DATA_OFFSET = 0x800000;

/** `nm -S -C` output: sized globals (data/bss) and functions. */
export function parseNm(text: string): FirmwareSymbol[] {
  const out: FirmwareSymbol[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]+) ([0-9a-fA-F]+) ([bBdDtT]) (.+)$/.exec(raw.trim());
    if (!m) continue;
    const [, addrHex = "0", sizeHex = "0", type = "t", name = ""] = m;
    const addr = Number.parseInt(addrHex, 16);
    const size = Number.parseInt(sizeHex, 16);
    const kind = /[bB]/.test(type) ? "bss" : /[dD]/.test(type) ? "data" : "function";
    out.push({
      name,
      size,
      kind,
      address: kind !== "function" && addr >= AVR_DATA_OFFSET ? addr - AVR_DATA_OFFSET : addr,
    });
  }
  return out.sort((a, b) => a.address - b.address);
}

/** "Sketch uses N bytes" / "Global variables use N bytes" from arduino-cli. */
export function parseSizes(log: string): { flashBytes: number; ramBytes: number } {
  const flash = /Sketch uses (\d+) bytes/.exec(log);
  const ram = /Global variables use (\d+) bytes/.exec(log);
  return { flashBytes: Number(flash?.[1] ?? 0), ramBytes: Number(ram?.[1] ?? 0) };
}

/**
 * Forward declarations for the top-level functions in a sketch, like the Arduino preprocessor
 * adds, so a sketch can call a function defined further down. Heuristic: a line at column 0 that
 * looks like `type name(args) {` (possibly with the brace on the next line).
 */
export function sketchPrototypes(source: string): string[] {
  const out: string[] = [];
  const lines = source.split(/\r?\n/);
  const re =
    /^((?:unsigned |signed |const |static |inline |long )*[A-Za-z_][\w:<>]*(?:\s*[*&])?)\s+([A-Za-z_]\w*)\s*\(([^;{}]*)\)\s*(\{.*)?$/;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? "";
    const m = re.exec(l);
    if (!m) continue;
    const [, type = "", name = "", args = ""] = m;
    if (
      ["if", "for", "while", "switch", "return", "else"].includes(type.trim()) ||
      name === "setup" ||
      name === "loop"
    )
      continue;
    const opens = m[4] !== undefined || (lines[i + 1] ?? "").trim().startsWith("{");
    if (!opens) continue;
    // Default arguments may only appear once: strip them from the prototype? No: keep the
    // definition's form and drop defaults from the prototype instead.
    out.push(`${type} ${name}(${args.replace(/\s*=\s*[^,)]+/g, "")});`);
  }
  return out;
}

/**
 * Scalar types of global variables from `objdump --dwarf=info`: variable name → how to decode it.
 * Follows typedef/const/volatile chains down to the base type.
 */
export function parseDwarfVariableTypes(text: string): Map<string, ValueType> {
  interface Die {
    tag: string;
    level: number;
    attrs: Record<string, string>;
  }
  const dies = new Map<number, Die>();
  const order: Die[] = [];
  let cur: Die | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const head = /^\s*<(\d+)><([0-9a-f]+)>: Abbrev Number: \d+ \((DW_TAG_\w+)\)/.exec(raw);
    if (head) {
      cur = { level: Number(head[1]), tag: head[3] ?? "", attrs: {} };
      dies.set(Number.parseInt(head[2] ?? "0", 16), cur);
      order.push(cur);
      continue;
    }
    const attr = /^\s*<[0-9a-f]+>\s+DW_AT_(\w+)\s*:\s*(.*)$/.exec(raw);
    if (attr && cur) cur.attrs[attr[1] ?? ""] = (attr[2] ?? "").trim();
  }
  const nameOf = (d: Die) => {
    const v = d.attrs.name ?? "";
    const i = v.lastIndexOf("): ");
    return i >= 0 ? v.slice(i + 3) : v;
  };
  const resolve = (d: Die | undefined, depth = 0): ValueType | undefined => {
    if (!d || depth > 8) return undefined;
    if (d.tag === "DW_TAG_base_type") {
      const size = Number(d.attrs.byte_size ?? 0);
      const enc = Number((d.attrs.encoding ?? "0").split(/\s/)[0]);
      if (enc === 4) return size === 4 ? "float" : undefined; // 8-byte double isn't on AVR
      if (enc === 2) return "bool";
      const signed = enc === 5 || enc === 6;
      return size === 1
        ? signed
          ? "i8"
          : "u8"
        : size === 2
          ? signed
            ? "i16"
            : "u16"
          : size === 4
            ? signed
              ? "i32"
              : "u32"
            : undefined;
    }
    if (["DW_TAG_typedef", "DW_TAG_const_type", "DW_TAG_volatile_type"].includes(d.tag)) {
      const ref = /<0x([0-9a-f]+)>/.exec(d.attrs.type ?? "");
      return ref ? resolve(dies.get(Number.parseInt(ref[1] ?? "0", 16)), depth + 1) : undefined;
    }
    return undefined;
  };
  const out = new Map<string, ValueType>();
  for (const d of order) {
    if (d.tag !== "DW_TAG_variable" || d.level !== 1 || !d.attrs.location?.includes("DW_OP_addr"))
      continue;
    let typeDie = d;
    // A definition may only point at its declaration (DW_AT_specification) for the name and type.
    const spec = /<0x([0-9a-f]+)>/.exec(d.attrs.specification ?? "");
    const decl = spec ? dies.get(Number.parseInt(spec[1] ?? "0", 16)) : undefined;
    if (decl)
      typeDie = {
        ...decl,
        attrs: {
          ...decl.attrs,
          ...d.attrs,
          name: d.attrs.name ?? decl.attrs.name ?? "",
          type: d.attrs.type ?? decl.attrs.type ?? "",
        },
      };
    const ref = /<0x([0-9a-f]+)>/.exec(typeDie.attrs.type ?? "");
    const t = ref ? resolve(dies.get(Number.parseInt(ref[1] ?? "0", 16))) : undefined;
    const name = nameOf(typeDie);
    if (t && name) out.set(name, t);
  }
  return out;
}
