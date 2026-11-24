import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  Board,
  CompileDiagnostic,
  CompileRequest,
  CompileResponse,
  FirmwareArtifact,
} from "@linelab/schema";
import {
  parseDecodedLines,
  parseDwarfVariableTypes,
  parseGccDiagnostics,
  parseNm,
  parseSizes,
  sketchPrototypes,
} from "./parse.js";
import { DEFAULT_LIMITS, runJob, type JobLimits } from "./sandbox.js";

export interface CompilerConfig {
  /** arduino-cli binary. */
  arduinoCli: string;
  /** Read-only arduino data directory with the arduino:avr core installed. */
  arduinoDataDir: string;
  /** Directory holding avr-objdump and avr-nm. */
  avrToolsBin: string;
  /** clang++ with the wasm32 target, and wasm-ld on PATH. */
  clang: string;
  /** packages/lfr-hal (include/, src/, imports.txt). */
  halDir: string;
  /** Arduino libraries available to every sketch (e.g. LineLabTelemetry), as library folders. */
  libraries: string[];
  /** Where per-job temporary directories are created. */
  workRoot: string;
  limits: JobLimits;
}

/** Boards whose firmware is emulated cycle-accurately (ATmega328P) and their arduino-cli FQBNs. */
export const EMULATED_FQBN: Partial<Record<Board, string>> = {
  "arduino:avr:uno": "arduino:avr:uno",
  "arduino:avr:nano": "arduino:avr:nano:cpu=atmega328",
  "arduino:avr:pro": "arduino:avr:pro:cpu=16MHzatmega328",
};

/** Preprocessor defines that let common board-specific code compile against the HAL. */
const HAL_DEFINES: Partial<Record<Board, string[]>> = {
  "esp32:esp32:esp32": ["ESP32", "ARDUINO_ARCH_ESP32", "LINELAB_BOARD_ESP32"],
  "esp32:esp32:esp32s3": [
    "ESP32",
    "ARDUINO_ARCH_ESP32",
    "CONFIG_IDF_TARGET_ESP32S3",
    "LINELAB_BOARD_ESP32",
  ],
  "esp32:esp32:esp32c3": [
    "ESP32",
    "ARDUINO_ARCH_ESP32",
    "CONFIG_IDF_TARGET_ESP32C3",
    "LINELAB_BOARD_ESP32",
  ],
  "stm32:stm32:bluepill_f103c8": ["ARDUINO_ARCH_STM32", "STM32F1xx", "LINELAB_BOARD_STM32"],
  "stm32:stm32:blackpill_f411ce": ["ARDUINO_ARCH_STM32", "STM32F4xx", "LINELAB_BOARD_STM32"],
  "teensy:avr:teensy40": ["TEENSYDUINO=159", "__IMXRT1062__", "LINELAB_BOARD_TEENSY"],
  "rp2040:rp2040:rpipico": ["ARDUINO_ARCH_RP2040", "LINELAB_BOARD_RP2040"],
  "rp2040:rp2040:rpipicow": ["ARDUINO_ARCH_RP2040", "LINELAB_BOARD_RP2040"],
  "rp2040:rp2040:seeed_xiao_rp2040": ["ARDUINO_ARCH_RP2040", "LINELAB_BOARD_RP2040"],
  "arduino:samd:nano_33_iot": ["ARDUINO_ARCH_SAMD", "LINELAB_BOARD_SAMD"],
  "arduino:avr:mega": ["ARDUINO_ARCH_AVR", "__AVR_ATmega2560__", "LINELAB_BOARD_AVR"],
  "arduino:avr:leonardo": ["ARDUINO_ARCH_AVR", "__AVR_ATmega32U4__", "LINELAB_BOARD_AVR"],
  "arduino:avr:micro": ["ARDUINO_ARCH_AVR", "__AVR_ATmega32U4__", "LINELAB_BOARD_AVR"],
  "arduino:megaavr:nona4809": ["ARDUINO_ARCH_MEGAAVR", "LINELAB_BOARD_AVR"],
};

export const tierOf = (board: Board) => (EMULATED_FQBN[board] ? "emulated" : "hal");

const sourceHash = (files: Record<string, string>) =>
  createHash("sha256")
    .update(
      Object.keys(files)
        .sort()
        .map((k) => `${k}\0${files[k] ?? ""}\0`)
        .join(""),
    )
    .digest("hex");

const baseEnv = (home: string): Record<string, string> => ({
  HOME: home,
  PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
  LANG: "C.UTF-8",
});

/** Compile a sketch. Each job gets a fresh temporary directory, deleted afterwards. */
export async function compile(req: CompileRequest, cfg: CompilerConfig): Promise<CompileResponse> {
  const dir = await mkdtemp(join(cfg.workRoot, "job-"));
  try {
    return tierOf(req.board) === "emulated"
      ? await compileAvr(req, cfg, dir)
      : await compileHal(req, cfg, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function mainIno(req: CompileRequest): string {
  const ino = Object.keys(req.files).find((f) => f.endsWith(".ino"));
  if (!ino) throw new Error("No .ino file.");
  return ino;
}

function failed(diagnostics: CompileDiagnostic[], log: string, fallback: string): CompileResponse {
  return {
    ok: false,
    diagnostics:
      diagnostics.length > 0
        ? diagnostics
        : [{ file: "", line: 0, column: 0, severity: "error", message: fallback }],
    log,
  };
}

async function compileAvr(
  req: CompileRequest,
  cfg: CompilerConfig,
  dir: string,
): Promise<CompileResponse> {
  const ino = mainIno(req);
  const name = ino.replace(/\.ino$/, "");
  const sketchDir = join(dir, name);
  await mkdir(sketchDir);
  for (const [f, text] of Object.entries(req.files))
    await writeFile(join(sketchDir, f === ino ? `${name}.ino` : f), text);
  const env = {
    ...baseEnv(dir),
    ARDUINO_DIRECTORIES_DATA: cfg.arduinoDataDir,
    ARDUINO_DIRECTORIES_USER: join(dir, "user"),
    ARDUINO_DIRECTORIES_DOWNLOADS: join(dir, "dl"),
    ARDUINO_UPDATER_ENABLE_NOTIFICATION: "false",
  };
  const fqbn = EMULATED_FQBN[req.board] ?? "";
  const out = join(dir, "out");
  const r = await runJob(
    cfg.arduinoCli,
    [
      "compile",
      "--fqbn",
      fqbn,
      "--build-path",
      join(dir, "build"),
      "--output-dir",
      out,
      "--warnings",
      "default",
      "--no-color",
      ...cfg.libraries.flatMap((lib) => ["--library", lib]),
      sketchDir,
    ],
    { cwd: dir, env, limits: cfg.limits },
  );
  const log = `${r.stdout}\n${r.stderr}`.replaceAll(dir, "");
  const diagnostics = parseGccDiagnostics(log);
  if (r.timedOut)
    return failed(
      [],
      log,
      `Compilation took longer than ${cfg.limits.timeoutMs / 1000} s and was stopped.`,
    );
  if (r.code !== 0)
    return failed(
      diagnostics.filter((d) => d.severity === "error"),
      log,
      "Compilation failed.",
    );

  const elf = join(out, `${name}.ino.elf`);
  const [lines, syms, info] = await Promise.all([
    runJob(join(cfg.avrToolsBin, "avr-objdump"), ["--dwarf=decodedline", elf], {
      cwd: dir,
      env,
      limits: cfg.limits,
    }),
    runJob(join(cfg.avrToolsBin, "avr-nm"), ["-S", "-C", elf], {
      cwd: dir,
      env,
      limits: cfg.limits,
    }),
    runJob(join(cfg.avrToolsBin, "avr-objdump"), ["--dwarf=info", elf], {
      cwd: dir,
      env,
      limits: cfg.limits,
    }),
  ]);
  const types = parseDwarfVariableTypes(info.stdout);
  const artifact: FirmwareArtifact = {
    board: req.board,
    tier: "emulated",
    hex: await readFile(join(out, `${name}.ino.hex`), "utf8"),
    lines: parseDecodedLines(lines.stdout),
    symbols: parseNm(syms.stdout).map((sym) => {
      const t = sym.kind !== "function" ? types.get(sym.name) : undefined;
      return t ? { ...sym, valueType: t } : sym;
    }),
    sourceHash: sourceHash(req.files),
    sizes: parseSizes(log),
    warnings: diagnostics.filter((d) => d.severity === "warning"),
  };
  return { ok: true, artifact, log };
}

async function compileHal(
  req: CompileRequest,
  cfg: CompilerConfig,
  dir: string,
): Promise<CompileResponse> {
  const ino = mainIno(req);
  const sources: string[] = [];
  for (const [f, text] of Object.entries(req.files)) {
    if (f === ino) {
      // What the Arduino preprocessor does: include Arduino.h, declare the sketch's functions,
      // and keep line numbers pointing at the .ino.
      const cpp = `#include <Arduino.h>\n${sketchPrototypes(text).join("\n")}\n#line 1 "${ino}"\n${text}`;
      await writeFile(join(dir, `${ino}.cpp`), cpp);
      sources.push(join(dir, `${ino}.cpp`));
    } else {
      await writeFile(join(dir, f), text);
      if (/\.(c|cpp)$/.test(f)) sources.push(join(dir, f));
    }
  }
  const halSrc = join(cfg.halDir, "src");
  for (const f of (await readdir(halSrc)).filter((n) => n.endsWith(".cpp")))
    sources.push(join(halSrc, f));
  // Bundled Arduino libraries: their headers on the include path, their sources compiled in.
  const libIncludes: string[] = [];
  for (const lib of cfg.libraries) {
    const src = join(lib, "src");
    libIncludes.push(`-I${src}`);
    for (const f of (await readdir(src)).filter((n) => n.endsWith(".cpp"))) sources.push(join(src, f));
  }
  const defines = (HAL_DEFINES[req.board] ?? []).map((d) => `-D${d}`);
  const wasm = join(dir, "sketch.wasm");
  const args = [
    "--target=wasm32",
    "-std=gnu++17",
    "-O2",
    "-ffreestanding",
    "-fno-exceptions",
    "-fno-rtti",
    "-fno-threadsafe-statics",
    "-nostdlib",
    "-Wall",
    "-Wno-unused-function",
    `-I${join(cfg.halDir, "include")}`,
    `-I${dir}`,
    ...libIncludes,
    "-DARDUINO=10819",
    "-DLINELAB_HAL=1",
    ...defines,
    ...sources,
    "-o",
    wasm,
    "-Wl,--no-entry",
    "-Wl,--export=setup",
    "-Wl,--export=loop",
    "-Wl,--export=hal_init",
    `-Wl,--allow-undefined-file=${join(cfg.halDir, "imports.txt")}`,
    "-Wl,-z,stack-size=65536",
    "-Wl,--initial-memory=1048576",
  ];
  const r = await runJob(cfg.clang, args, { cwd: dir, env: baseEnv(dir), limits: cfg.limits });
  const log = `${r.stdout}\n${r.stderr}`
    .replaceAll(`${dir}/`, "")
    .replaceAll(cfg.halDir, "lfr-hal");
  const diagnostics = parseGccDiagnostics(log).map((d) =>
    d.file === `${ino}.cpp` ? { ...d, file: ino } : d,
  );
  if (r.timedOut)
    return failed(
      [],
      log,
      `Compilation took longer than ${cfg.limits.timeoutMs / 1000} s and was stopped.`,
    );
  if (r.code !== 0) {
    // Linker errors for functions the HAL doesn't provide.
    const names = new Set(
      [...log.matchAll(/undefined symbol: ([^\n(]+)/g)].map((m) => (m[1] ?? "?").trim()),
    );
    const undef = [...names].map((name) => ({
      file: ino,
      line: 0,
      column: 0,
      severity: "error" as const,
      message: `${name}() isn't available in LineLab's simulated Arduino core yet.`,
    }));
    return failed(
      [...diagnostics.filter((d) => d.severity === "error"), ...undef],
      log,
      "Compilation failed.",
    );
  }
  const bytes = await readFile(wasm);
  const artifact: FirmwareArtifact = {
    board: req.board,
    tier: "hal",
    wasmBase64: bytes.toString("base64"),
    lines: [],
    symbols: [],
    sourceHash: sourceHash(req.files),
    sizes: { flashBytes: bytes.length, ramBytes: 0 },
    warnings: diagnostics.filter((d) => d.severity === "warning"),
  };
  return { ok: true, artifact, log };
}

export { DEFAULT_LIMITS };
