// Compile examples/firmware/* and write each artifact next to the sketch
// (examples/firmware/<name>/<name>.<board>.artifact.json). The firmware-runtime tests run these
// artifacts, so they don't need a toolchain. Needs arduino-cli (ARDUINO_CLI, ARDUINO_DATA_DIR)
// and clang++ with the wasm32 target.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Board } from "@linelab/schema";
import { compile } from "../src/compile.js";
import { configFromEnv } from "../src/config.js";

const root = join(import.meta.dirname, "..", "..", "..", "examples", "firmware");
const BOARDS: Record<string, Board[]> = {
  good_pid: ["arduino:avr:nano"],
  blink: ["arduino:avr:nano"],
  esp32_pid: ["esp32:esp32:esp32"],
};
const NANO: Board = "arduino:avr:nano";
const cfg = configFromEnv();
let failed = 0;
// examples/firmware/<name>, plus the failure-detection fixtures in examples/firmware/buggy/<name>
// (all of which target the reference Nano robot).
const sketches = [
  ...readdirSync(root)
    .filter((n) => BOARDS[n])
    .map((n) => ({ name: n, dir: join(root, n), boards: BOARDS[n] ?? [] })),
  ...readdirSync(join(root, "buggy"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ name: d.name, dir: join(root, "buggy", d.name), boards: [NANO] })),
];
for (const { name, dir, boards } of sketches) {
  for (const board of boards) {
    const files = Object.fromEntries(
      readdirSync(dir)
        .filter((f) => /\.(ino|h|cpp)$/.test(f))
        .map((f) => [f, readFileSync(join(dir, f), "utf8")]),
    );
    const r = await compile({ board, files }, cfg);
    if (!r.ok) {
      failed++;
      console.error(`✗ ${name} (${board})\n${r.log}`);
      continue;
    }
    const out = join(dir, `${name}.${board.split(":").pop() ?? board}.artifact.json`);
    writeFileSync(out, `${JSON.stringify(r.artifact)}\n`);
    console.log(
      `✓ ${name} (${board}): ${r.artifact.sizes.flashBytes} bytes, ${r.artifact.lines.length} line rows, ${r.artifact.symbols.length} symbols`,
    );
  }
}
process.exitCode = failed > 0 ? 1 : 0;
