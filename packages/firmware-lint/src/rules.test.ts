import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lintSketch, type PinContext } from "./rules.js";
import { evaluate, parseSource } from "./source.js";

const ids = (src: string, pins?: PinContext) =>
  lintSketch(src, pins ? { pins } : {}).map((f) => `${f.ruleId}@${String(f.line)}`);
const sketch = (body: string) => `void setup() {}\n${body}`;

describe("source model", () => {
  it("finds functions, declarations and constant values without being fooled by comments", () => {
    const src = parseSource(
      "// int fake = 1;\nconst uint8_t S[3] = {A0, A1, 7};\nint lo = 1023, hi = 0;\nvoid loop() {\n  float e = 0; /* { */\n}\n",
    );
    expect(src.functions.map((f) => [f.name, f.line])).toEqual([["loop", 4]]);
    expect(src.decls.map((d) => [d.name, d.type, d.line, d.local])).toEqual([
      ["S", "uint8_t", 2, false],
      ["lo", "int", 3, false],
      ["hi", "int", 3, false],
      ["e", "float", 5, true],
    ]);
    expect(evaluate(src, "S[i]")).toEqual([14, 15, 7]);
  });
});

describe("rules: each triggers on the bug and stays quiet on the fix", () => {
  it.each([
    [
      "lfr.delay-in-loop",
      "void loop() {\n  read();\n  delay(30);\n}\n",
      4,
      "void loop() {\n  read();\n  delay(2);\n}\nvoid setup2() {}\n",
    ],
    [
      "lfr.integer-pid-math",
      "int KP = 2;\nlong error;\nvoid loop() {\n  int turn = error / 40 * KP;\n}\n",
      2,
      "float Kp = 0.08;\nlong error;\nvoid loop() {\n  float turn = Kp * error;\n}\n",
    ],
    [
      "lfr.integral-no-clamp",
      "float integral = 0;\nvoid loop() {\n  integral += err;\n}\n",
      4,
      "float integral = 0;\nvoid loop() {\n  integral += err;\n  integral = constrain(integral, -500, 500);\n}\n",
    ],
    [
      "lfr.millis-overflow",
      "unsigned long last;\nvoid loop() {\n  if (millis() > last + 100) last = millis();\n}\n",
      4,
      "unsigned long last;\nvoid loop() {\n  if (millis() - last >= 100) last = millis();\n}\n",
    ],
    [
      "lfr.analogwrite-range",
      "int s;\nvoid loop() {\n  s = 200 + turn;\n  analogWrite(3, s);\n}\n",
      5,
      "int s;\nvoid loop() {\n  s = constrain(200 + turn, 0, 255);\n  analogWrite(3, s);\n}\n",
    ],
    [
      "lfr.pid-state-local",
      "void loop() {\n  float lastError = 0;\n}\n",
      3,
      "float lastError = 0;\nvoid loop() {\n  static float prevErr = 0;\n}\n",
    ],
    [
      "lfr.float-equality",
      "float e;\nvoid loop() {\n  if (e == 0.5) go();\n}\n",
      4,
      "int e;\nvoid loop() {\n  if (e == 5) go();\n}\n",
    ],
    [
      "lfr.no-derivative",
      "float Kp = 0.1;\nfloat Kd = 0;\nvoid loop() { t = Kp * error; }\n",
      3,
      "float Kp = 0.1;\nfloat Kd = 2.5;\nvoid loop() { t = Kp * error + Kd * (error - lastError); }\n",
    ],
    [
      "lfr.hardcoded-threshold",
      "int v[8];\nvoid loop() {\n  v[0] = analogRead(A0);\n  if (v[0] > 900) left();\n}\n",
      5,
      "int v[8];\nvoid loop() {\n  v[0] = analogRead(A0);\n  if (v[0] > mid) left();\n}\n",
    ],
    [
      "lfr.unguarded-average",
      "long sum, w, e;\nvoid loop() {\n  e = w / sum;\n}\n",
      4,
      "long sum, w, e;\nvoid loop() {\n  if (sum > 0) e = w / sum;\n}\n",
    ],
  ])("%s", (rule, bad, line, good) => {
    expect(ids(sketch(bad))).toContain(`${rule}@${String(line)}`);
    expect(ids(sketch(good)).filter((x) => x.startsWith(`${rule}@`))).toEqual([]);
  });

  it("lfr.pin-mismatch: code drives a pin the wiring doesn't use, and names the right one", () => {
    const pins: PinContext = {
      pinName: (n) => (n >= 14 ? `A${String(n - 14)}` : `D${String(n)}`),
      analogBase: 14,
      driverInputs: [
        { pin: "D3", label: "TB6612 PWMA" },
        { pin: "D2", label: "TB6612 AIN1" },
      ],
      sensorOutputs: [{ pin: "A0", label: "QTR OUT1" }],
    };
    const bad =
      "const int PWMA = 9;\nvoid setup() {}\nvoid loop() {\n  digitalWrite(2, HIGH);\n  analogWrite(PWMA, 100);\n  analogRead(A1);\n}\n";
    const f = lintSketch(bad, { pins }).filter((x) => x.ruleId === "lfr.pin-mismatch");
    expect(f.map((x) => x.line)).toEqual([1, 6]);
    expect(f[0]?.message).toMatch(/D9, which isn't wired.*TB6612 PWMA on D3/);
    expect(f[1]?.message).toMatch(/reads A1.*QTR OUT1 on A0/);
    const good =
      "const int PWMA = 3;\nvoid setup() {}\nvoid loop() {\n  digitalWrite(2, HIGH);\n  analogWrite(PWMA, 100);\n  analogRead(A0);\n}\n";
    expect(lintSketch(good, { pins }).filter((x) => x.ruleId === "lfr.pin-mismatch")).toEqual([]);
  });

  it("lfr.pin-mismatch follows pins passed through a helper's parameters", () => {
    const pins: PinContext = {
      pinName: (n) => `D${String(n)}`,
      analogBase: 14,
      driverInputs: [{ pin: "D3", label: "PWMA" }],
      sensorOutputs: [],
    };
    const bad =
      "const uint8_t PWMA = 9;\nvoid drive(uint8_t pwm, int s) {\n  analogWrite(pwm, s);\n}\nvoid setup() {}\nvoid loop() {\n  drive(PWMA, 100);\n}\n";
    expect(
      lintSketch(bad, { pins })
        .filter((x) => x.ruleId === "lfr.pin-mismatch")
        .map((x) => x.line),
    ).toEqual([1]);
    expect(
      lintSketch(bad.replace("= 9", "= 3"), { pins }).filter(
        (x) => x.ruleId === "lfr.pin-mismatch",
      ),
    ).toEqual([]);
  });
});

describe("the good examples are clean", () => {
  const root = join(import.meta.dirname, "..", "..", "..", "examples", "firmware");
  it.each(["good_pid", "esp32_pid"])("%s has no findings", (name) => {
    expect(lintSketch(readFileSync(join(root, name, `${name}.ino`), "utf8"))).toEqual([]);
  });
  it("blink (not a line follower) is told its delays would block a control loop", () => {
    expect(
      lintSketch(readFileSync(join(root, "blink", "blink.ino"), "utf8")).map((f) => f.ruleId),
    ).toEqual(["lfr.delay-in-loop", "lfr.delay-in-loop"]);
  });
});
