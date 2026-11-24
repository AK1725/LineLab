import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CompilerConfig } from "./compile.js";
import { DEFAULT_LIMITS } from "./sandbox.js";

/** avr-gcc's bin directory inside an arduino data dir (newest installed version). */
function findAvrTools(dataDir: string): string {
  const root = join(dataDir, "packages", "arduino", "tools", "avr-gcc");
  if (!existsSync(root)) return "";
  const v = readdirSync(root).sort().at(-1);
  return v ? join(root, v, "bin") : "";
}

/** Configuration from the environment (all paths absolute). */
export function configFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): CompilerConfig & { cppcheck: string; clangTidy: string } {
  const here = dirname(fileURLToPath(import.meta.url));
  const dataDir = env.ARDUINO_DATA_DIR ?? join(env.HOME ?? "/root", ".arduino15");
  return {
    arduinoCli: env.ARDUINO_CLI ?? "arduino-cli",
    arduinoDataDir: dataDir,
    avrToolsBin: env.AVR_TOOLS_BIN ?? findAvrTools(dataDir),
    clang: env.CLANG ?? "clang++",
    cppcheck: env.CPPCHECK ?? "cppcheck",
    clangTidy: env.CLANG_TIDY ?? "clang-tidy",
    halDir: resolve(env.LFR_HAL_DIR ?? join(here, "..", "..", "..", "packages", "lfr-hal")),
    libraries: (env.LINELAB_ARDUINO_LIBRARIES ?? join(here, "..", "..", "..", "packages", "telemetry-lib", "arduino", "LineLabTelemetry"))
      .split(",")
      .map((p) => resolve(p.trim()))
      .filter((p) => p !== "" && existsSync(p)),
    workRoot: env.COMPILER_WORK_DIR ?? tmpdir(),
    limits: {
      ...DEFAULT_LIMITS,
      ...(env.COMPILER_TIMEOUT_MS ? { timeoutMs: Number(env.COMPILER_TIMEOUT_MS) } : {}),
      ...(env.COMPILER_MEMORY_MB ? { memoryMb: Number(env.COMPILER_MEMORY_MB) } : {}),
    },
  };
}
