import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AnalyzeResponse, CompileRequest, FirmwareFinding } from "@linelab/schema";
import type { CompilerConfig } from "./compile.js";
import { sketchPrototypes } from "./parse.js";
import { runJob } from "./sandbox.js";

/** clang-tidy checks that matter for small embedded sketches (noisy style checks left out). */
export const TIDY_CHECKS = [
  "-*",
  "bugprone-*",
  "-bugprone-easily-swappable-parameters",
  "-bugprone-narrowing-conversions",
  "-bugprone-implicit-widening-of-multiplication-result",
  "-bugprone-reserved-identifier",
  "clang-analyzer-core.*",
  "clang-analyzer-deadcode.*",
  "cert-flp30-c",
  "readability-misleading-indentation",
  "misc-redundant-expression",
].join(",");

const CPPCHECK_SEVERITY: Record<string, FirmwareFinding["severity"]> = {
  error: "error",
  warning: "warning",
  style: "info",
  performance: "info",
  portability: "info",
  information: "info",
};

/** `file:line:column:severity:id:message` lines (our cppcheck template). */
export function parseCppcheck(out: string, file: string): FirmwareFinding[] {
  const res: FirmwareFinding[] = [];
  for (const raw of out.split(/\r?\n/)) {
    const m = /^(.+?):(\d+):(\d+):(\w+):(\w+):(.*)$/.exec(raw.trim());
    if (!m || !(m[1] ?? "").endsWith(file)) continue;
    res.push({
      tool: "cppcheck",
      ruleId: `cppcheck.${m[5] ?? ""}`,
      severity: CPPCHECK_SEVERITY[m[4] ?? ""] ?? "info",
      file,
      line: Number(m[2]),
      column: Number(m[3]),
      message: m[6] ?? "",
    });
  }
  return res;
}

/**
 * `file:line:col: warning: message [check-name]` lines from clang-tidy. clang-tidy reports the
 * generated .cpp's own line numbers (it ignores #line), so `lineOffset` maps them back.
 */
export function parseClangTidy(out: string, file: string, lineOffset = 0): FirmwareFinding[] {
  const res: FirmwareFinding[] = [];
  const seen = new Set<string>();
  for (const raw of out.split(/\r?\n/)) {
    const m = /^(.+?):(\d+):(\d+): (warning|error): (.*?)(?: \[([\w.,-]+)\])?$/.exec(raw.trim());
    if (!m || !((m[1] ?? "").endsWith(file) || (m[1] ?? "").endsWith(`${file}.cpp`))) continue;
    const line = Number(m[2]) - ((m[1] ?? "").endsWith(".cpp") ? lineOffset : 0);
    if (line < 1) continue;
    const key = `${String(line)}:${m[6] ?? ""}:${m[5] ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    res.push({
      tool: "clang-tidy",
      ruleId: m[6] ? `clang-tidy.${m[6]}` : "clang-tidy.diagnostic",
      severity: m[4] === "error" ? "error" : "warning",
      file,
      line,
      column: Number(m[3]),
      message: m[5] ?? "",
    });
  }
  return res;
}

/**
 * cppcheck and clang-tidy on the sketch, parsed against LineLab's Arduino headers (lfr-hal), which
 * cover the Arduino API for every board. Runs in the same sandbox as compiling.
 */
export async function analyze(
  req: CompileRequest,
  cfg: CompilerConfig & { cppcheck: string; clangTidy: string },
): Promise<AnalyzeResponse> {
  const ino = Object.keys(req.files).find((f) => f.endsWith(".ino"));
  if (!ino) return { findings: [], log: "No .ino file." };
  const dir = await mkdtemp(join(cfg.workRoot, "analyze-"));
  try {
    const text = req.files[ino] ?? "";
    const cpp = join(dir, `${ino}.cpp`);
    const header = ["#include <Arduino.h>", ...sketchPrototypes(text), `#line 1 "${ino}"`];
    await writeFile(cpp, `${header.join("\n")}\n${text}`);
    const board = req.board.startsWith("esp32")
      ? "LINELAB_BOARD_ESP32"
      : req.board.startsWith("stm32")
        ? "LINELAB_BOARD_STM32"
        : req.board.startsWith("rp2040")
          ? "LINELAB_BOARD_RP2040"
          : "LINELAB_BOARD_AVR";
    for (const [f, t] of Object.entries(req.files)) if (f !== ino) await writeFile(join(dir, f), t);
    const inc = join(cfg.halDir, "include");
    const env = { HOME: dir, PATH: process.env.PATH ?? "/usr/bin:/bin" };
    const [cc, tidy] = await Promise.all([
      runJob(
        cfg.cppcheck,
        [
          "--enable=warning,style,performance,portability",
          `-D${board}`,
          "--std=c++17",
          "--language=c++",
          "--quiet",
          "--inline-suppr",
          "--suppress=missingIncludeSystem",
          "--suppress=unusedFunction",
          "--suppress=unmatchedSuppression",
          `-I${inc}`,
          "--template={file}:{line}:{column}:{severity}:{id}:{message}",
          cpp,
        ],
        { cwd: dir, env, limits: cfg.limits },
      ),
      runJob(
        cfg.clangTidy,
        [
          cpp,
          `--checks=${TIDY_CHECKS}`,
          "--quiet",
          "--",
          "--target=wasm32",
          "-std=gnu++17",
          "-ffreestanding",
          "-nostdlib",
          `-I${inc}`,
          `-I${dir}`,
          "-DARDUINO=10819",
          "-DLINELAB_HAL=1",
          `-D${board}`,
        ],
        { cwd: dir, env, limits: cfg.limits },
      ),
    ]);
    const findings = [
      ...parseCppcheck(cc.stderr + cc.stdout, ino),
      ...parseClangTidy(tidy.stdout + tidy.stderr, ino, header.length),
    ].sort((a, b) => a.line - b.line);
    const log = [
      `cppcheck: ${cc.timedOut ? "timed out" : `exit ${String(cc.code)}`}`,
      `clang-tidy: ${tidy.timedOut ? "timed out" : `exit ${String(tidy.code)}`}`,
    ].join("\n");
    return { findings, log };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
