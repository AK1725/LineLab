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
const cfg = configFromEnv();
let failed = 0;
for (const name of readdirSync(root)) {
  for (const board of BOARDS[name] ?? []) {
    const files = Object.fromEntries(
      readdirSync(join(root, name))
        .filter((f) => /\.(ino|h|cpp)$/.test(f))
        .map((f) => [f, readFileSync(join(root, name, f), "utf8")]),
    );
    const r = await compile({ board, files }, cfg);
    if (!r.ok) {
      failed++;
      console.error(`✗ ${name} (${board})\n${r.log}`);
      continue;
    }
    const out = join(root, name, `${name}.${board.split(":").pop() ?? board}.artifact.json`);
    writeFileSync(out, `${JSON.stringify(r.artifact)}\n`);
    console.log(
      `✓ ${name} (${board}): ${r.artifact.sizes.flashBytes} bytes, ${r.artifact.lines.length} line rows, ${r.artifact.symbols.length} symbols`,
    );
  }
}
process.exitCode = failed > 0 ? 1 : 0;
