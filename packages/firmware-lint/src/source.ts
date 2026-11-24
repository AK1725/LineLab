/**
 * A light model of an Arduino sketch: code with comments and string literals blanked (line numbers
 * kept), function bodies, declarations and constant values. Not a C++ parser: enough structure for
 * pattern rules that can name a line.
 */

export interface Decl {
  name: string;
  type: string;
  line: number;
  /** Declared inside a function body. */
  local: boolean;
  fn: string | undefined;
  isStatic: boolean;
  isConst: boolean;
  /** Initializer text (after `=`), if any. */
  init: string | undefined;
  /** Array elements, for `x[] = { ... }`. */
  elements: string[] | undefined;
}

export interface Fn {
  name: string;
  line: number;
  /** Character offsets of the body, between the braces. */
  bodyStart: number;
  bodyEnd: number;
  /** Parameter names, in order. */
  params: string[];
}

export interface Source {
  file: string;
  text: string;
  /** Same length as text; comments and string/char literals replaced by spaces. */
  code: string;
  lineOf: (offset: number) => number;
  functions: Fn[];
  decls: Decl[];
  declOf: (name: string, at?: number) => Decl | undefined;
  fnAt: (offset: number) => Fn | undefined;
}

function blank(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i] ?? "";
    const n = text[i + 1] ?? "";
    if (c === "/" && n === "/") {
      while (i < text.length && text[i] !== "\n") {
        out += " ";
        i++;
      }
    } else if (c === "/" && n === "*") {
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        out += text[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += "  ";
      i += 2;
    } else if (c === '"' || c === "'") {
      out += c;
      i++;
      while (i < text.length && text[i] !== c && text[i] !== "\n") {
        if (text[i] === "\\") {
          out += " ";
          i++;
        }
        out += " ";
        i++;
      }
      out += c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out.slice(0, text.length);
}

const TYPE = String.raw`(?:static\s+|const\s+|volatile\s+|unsigned\s+|signed\s+)*(?:long\s+long|unsigned\s+long|long|int|short|char|byte|bool|boolean|float|double|uint8_t|int8_t|uint16_t|int16_t|uint32_t|int32_t|size_t|word)`;

export const INTEGER_TYPE =
  /\b(long|int|short|char|byte|uint8_t|int8_t|uint16_t|int16_t|uint32_t|int32_t|size_t|word)\b/;
export const FLOAT_TYPE = /\b(float|double)\b/;

export function parseSource(text: string, file = "sketch.ino"): Source {
  const code = blank(text);
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  const lineOf = (off: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((starts[mid] ?? 0) <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  // Top-level function definitions: `type name(args) {` at brace depth 0.
  const functions: Fn[] = [];
  let depth = 0;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === "{") {
      if (depth === 0) {
        const head = code.slice(Math.max(0, i - 300), i);
        const m = /([A-Za-z_]\w*)\s*\(([^()]*)\)\s*(?:const\s*)?$/.exec(head);
        if (m && !/\b(if|for|while|switch|else)\s*$/.test(head.slice(0, m.index))) {
          let d = 0;
          let j = i;
          for (; j < code.length; j++) {
            if (code[j] === "{") d++;
            else if (code[j] === "}" && --d === 0) break;
          }
          const params = splitTop(m[2] ?? "").flatMap((p) => {
            const name = /([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*(?:=[^,]*)?$/.exec(p.trim())?.[1];
            return name && p.trim() !== "void" ? [name] : [];
          });
          functions.push({
            name: m[1] ?? "",
            line: lineOf(i - (head.length - m.index)),
            bodyStart: i + 1,
            bodyEnd: j,
            params,
          });
        }
      }
      depth++;
    } else if (ch === "}") depth = Math.max(0, depth - 1);
  }
  const fnAt = (off: number) => functions.find((f) => off >= f.bodyStart && off < f.bodyEnd);

  // Declarations, including comma lists: `int lo = 1023, hi = 0;`, arrays and #define.
  const decls: Decl[] = [];
  const declRe = new RegExp(String.raw`(^|[;{}(]\s*|\n\s*)(${TYPE})\s+([^;]+?);`, "g");
  for (const m of code.matchAll(declRe)) {
    const typeText = (m[2] ?? "").trim();
    // A function declaration or definition, not a variable.
    if (/^\s*\*?\s*[A-Za-z_]\w*\s*\(/.test(m[3] ?? "")) continue;
    const typeStart = m.index + (m[1] ?? "").length;
    const listStart = typeStart + (m[2] ?? "").length;
    const fn = fnAt(typeStart);
    let offset = listStart;
    for (const part of splitTop(m[3] ?? "")) {
      const pm = /^\s*\*?\s*([A-Za-z_]\w*)\s*(\[[^\]]*\])?\s*(?:=\s*([\s\S]+))?$/.exec(part);
      const at = code.indexOf(part, offset);
      offset = at + part.length;
      if (!pm) continue;
      const init = pm[3]?.trim();
      const elements =
        pm[2] !== undefined && init?.startsWith("{")
          ? splitTop(init.slice(1, init.lastIndexOf("}"))).map((s) => s.trim())
          : undefined;
      decls.push({
        name: pm[1] ?? "",
        type: typeText.replace(/\b(static|const|volatile)\s+/g, "").trim(),
        line: lineOf(at >= 0 ? at : listStart),
        local: fn !== undefined,
        fn: fn?.name,
        isStatic: /\bstatic\b/.test(typeText),
        isConst: /\bconst\b/.test(typeText),
        init,
        elements,
      });
    }
  }
  for (const m of code.matchAll(/^\s*#define\s+([A-Za-z_]\w*)\s+([^\n]+)$/gm)) {
    const v = (m[2] ?? "").trim();
    decls.push({
      name: m[1] ?? "",
      type: /^-?\d+$/.test(v) ? "int" : /^-?\d*\.\d+f?$/.test(v) ? "float" : "macro",
      line: lineOf(m.index),
      local: false,
      fn: undefined,
      isStatic: false,
      isConst: true,
      init: v,
      elements: undefined,
    });
  }
  // Function parameters are locals of that function.
  for (const f of functions) {
    const head = code.slice(Math.max(0, f.bodyStart - 400), f.bodyStart);
    const pm = /\(([^()]*)\)\s*(?:const\s*)?\{$/.exec(head);
    for (const p of splitTop(pm?.[1] ?? "")) {
      const q = new RegExp(String.raw`^\s*(${TYPE})\s*[&*]?\s*([A-Za-z_]\w*)`).exec(p);
      if (q)
        decls.push({
          name: q[2] ?? "",
          type: (q[1] ?? "").replace(/\b(const)\s+/g, ""),
          line: f.line,
          local: true,
          fn: f.name,
          isStatic: false,
          isConst: false,
          init: undefined,
          elements: undefined,
        });
    }
  }
  const declOf = (name: string, at?: number) => {
    const fn = at !== undefined ? fnAt(at)?.name : undefined;
    return (
      decls.find((d) => d.name === name && d.local && d.fn === fn) ??
      decls.find((d) => d.name === name && !d.local)
    );
  };
  return { file, text, code, lineOf, functions, decls, declOf, fnAt };
}

/** Split on commas that aren't inside (), [] or {}. */
export function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim() !== "") out.push(cur);
  return out;
}

/** Arguments of every call to `fn(...)`: offset of the call and the argument texts. */
export function calls(src: Source, fn: string): { at: number; args: string[] }[] {
  const out: { at: number; args: string[] }[] = [];
  const re = new RegExp(String.raw`\b${fn}\s*\(`, "g");
  for (const m of src.code.matchAll(re)) {
    const open = m.index + m[0].length;
    let d = 1;
    let j = open;
    for (; j < src.code.length && d > 0; j++) {
      if (src.code[j] === "(") d++;
      else if (src.code[j] === ")") d--;
    }
    out.push({ at: m.index, args: splitTop(src.code.slice(open, j - 1)).map((a) => a.trim()) });
  }
  return out;
}

/**
 * Numeric value of a constant expression (literals, named constants, A0–A7 on AVR boards).
 * Arrays give all their elements.
 */
export function evaluate(src: Source, expr: string, analogBase = 14, depth = 0): number[] {
  const e = expr.trim().replace(/^\((.*)\)$/, "$1");
  if (depth > 6) return [];
  if (/^-?\d+$/.test(e)) return [Number(e)];
  if (/^0x[0-9a-f]+$/i.test(e)) return [Number.parseInt(e, 16)];
  const a = /^A(\d)$/.exec(e);
  if (a) return [analogBase + Number(a[1])];
  const arr = /^([A-Za-z_]\w*)\s*\[[^\]]+\]$/.exec(e);
  const d = src.decls.find(
    (x) =>
      x.name === (arr ? arr[1] : e) && (x.isConst || x.type === "macro" || x.init !== undefined),
  );
  if (!d) return [];
  if (arr) return (d.elements ?? []).flatMap((el) => evaluate(src, el, analogBase, depth + 1));
  return d.init !== undefined ? evaluate(src, d.init, analogBase, depth + 1) : [];
}
