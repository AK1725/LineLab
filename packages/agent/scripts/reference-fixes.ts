// Write examples/firmware/buggy/<name>/fix.diff (a hand-written reference fix for each buggy
// fixture) and fill the compile cache (examples/firmware/.compile-cache) with real compiler
// output for every buggy and fixed sketch, so tests and the e2e path run offline.
// Needs arduino-cli (ARDUINO_CLI, ARDUINO_DATA_DIR), like `pnpm --filter @linelab/compiler examples:build`.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compile, configFromEnv } from "@linelab/compiler";
import { CachedCompiler } from "../src/compiler.js";
import { makeUnifiedDiff } from "../src/patch.js";

const repo = join(import.meta.dirname, "..", "..", "..");
const buggy = join(repo, "examples", "firmware", "buggy");
export const FILE = "sketch.ino";

/** [find, replace] edits that turn each buggy sketch into a fixed one. */
const FIXES: Record<string, [string, string][]> = {
  no_derivative: [
    [
      'float Kd = 0;             // "D just adds noise"',
      "float Kd = 2.5;           // damping: PWM counts per (error unit per ms)",
    ],
  ],
  p_too_high: [
    [
      'float Kp = 0.5;           // "more is snappier"',
      "float Kp = 0.08;          // PWM counts per error unit",
    ],
  ],
  blocking_delay: [['  delay(25);  // "give the motors time to react"\n', ""]],
  integer_pid: [
    [
      "int KP_DIV = 12;          // turn = error / 12 (integer)\n",
      "float Kp = 0.08;          // PWM counts per error unit\n",
    ],
    [
      "long turn = error / KP_DIV + (long)(Kd * (error - lastError) / dtMs);",
      "float turn = Kp * error + Kd * (error - lastError) / dtMs;",
    ],
  ],
  missing_integral_clamp: [
    [
      "  integral += error * dtMs;\n",
      "  integral += error * dtMs;\n  integral = constrain(integral, -40000.0, 40000.0);  // limit windup\n",
    ],
  ],
  wrong_pin_numbers: [
    [
      'const uint8_t PWMA = 9, AIN1 = 2, AIN2 = 4;  // "PWM is on 9 on my other robot"',
      "const uint8_t PWMA = 3, AIN1 = 2, AIN2 = 4;  // as wired",
    ],
  ],
  inverted_motor: [
    [
      "  setMotor(PWMB, BIN2, BIN1, base + (int)turn);",
      "  setMotor(PWMB, BIN1, BIN2, base + (int)turn);",
    ],
  ],
  no_line_lost_recovery: [
    [
      "  if (lost) error = 0;  // nothing seen: go straight",
      "  if (lost) error = lastError >= 0 ? 3500 : -3500;  // turn towards where the line was",
    ],
  ],
  millis_overflow: [
    ["  if (millis() > lastPrint + 250) {", "  if (millis() - lastPrint >= 250) {"],
  ],
  saturating_pwm: [
    [
      "void setMotor(uint8_t pwm, uint8_t in1, uint8_t in2, int speed) {\n",
      "void setMotor(uint8_t pwm, uint8_t in1, uint8_t in2, int speed) {\n  speed = constrain(speed, -255, 255);\n",
    ],
    [
      'int baseSpeed = 230;      // "full speed ahead"',
      "int baseSpeed = 150;      // of 255, leaves room for corrections",
    ],
  ],
  wrong_sensor_order: [
    [
      "    weighted += dark * (1000L * i - 3500);  // sensor 1 is on the right... isn't it?",
      "    weighted += dark * (3500 - 1000L * i);  // sensor 1 (A0) is on the left",
    ],
  ],
  uncalibrated_thresholds: [
    [
      "    long dark = v[i] > 900 ? 900 : 0;  // black reads above 900 on my desk",
      "    long dark = span > 150 ? constrain((long)(v[i] - lo) * 1000 / span - 100, 0, 900) : 0;",
    ],
  ],
};

const cfg = configFromEnv();
const cache = new CachedCompiler(join(repo, "examples", "firmware", ".compile-cache"), {
  compile: (r) => compile(r, cfg),
});
const extra = process.argv.slice(2); // extra .ino files to put in the cache (e.g. scripted e2e patches)
for (const [name, edits] of Object.entries(FIXES)) {
  const src = readFileSync(join(buggy, name, `${name}.ino`), "utf8");
  let fixed = src;
  for (const [a, b] of edits) {
    if (!fixed.includes(a)) throw new Error(`${name}: edit not found: ${a}`);
    fixed = fixed.replace(a, b);
  }
  writeFileSync(join(buggy, name, "fix.diff"), makeUnifiedDiff(src, fixed, FILE));
  for (const text of [src, fixed]) {
    const r = await cache.compile({ board: "arduino:avr:nano", files: { [FILE]: text } });
    if (!r.ok) throw new Error(`${name}: ${r.log}`);
  }
  console.log(`✓ ${name}`);
}
for (const f of extra) {
  const r = await cache.compile({
    board: "arduino:avr:nano",
    files: { [FILE]: readFileSync(f, "utf8") },
  });
  console.log(`${r.ok ? "✓" : "✗"} ${f}`);
}
