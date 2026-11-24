import type { FirmwareFinding } from "@linelab/schema";
import { calls, evaluate, FLOAT_TYPE, INTEGER_TYPE, parseSource, type Source } from "./source.js";

/** What the design's wiring says about pins (for lfr.pin-mismatch). */
export interface PinContext {
  /** MCU pin id for a number used in code (e.g. 3 → "D3", 36 → "GPIO36"). */
  pinName: (n: number) => string | undefined;
  /** The number A0 stands for on this board (14 on Uno/Nano); undefined if A0 isn't a pin macro. */
  analogBase: number | undefined;
  /** MCU pins the netlist connects to motor-driver inputs, with a label like "TB6612 PWMA". */
  driverInputs: { pin: string; label: string }[];
  /** MCU pins the netlist connects to line-sensor outputs. */
  sensorOutputs: { pin: string; label: string }[];
}

export interface LintContext {
  src: Source;
  pins?: PinContext;
}

export interface LintRule {
  id: string;
  title: string;
  check: (ctx: LintContext) => FirmwareFinding[];
}

const finding = (
  src: Source,
  ruleId: string,
  severity: FirmwareFinding["severity"],
  line: number,
  message: string,
  explanation: string,
): FirmwareFinding => ({
  tool: "linelab",
  ruleId,
  severity,
  file: src.file,
  line,
  message,
  explanation,
});

const isInt = (src: Source, token: string, at: number): boolean => {
  const t = token.trim();
  if (/^-?\d+L?$/.test(t)) return true;
  if (/^-?\d*\.\d+f?$/.test(t)) return false;
  const name =
    /^\(?\s*(?:long|int)\s*\)?\s*([A-Za-z_]\w*)$/.exec(t)?.[1] ??
    (/^[A-Za-z_]\w*$/.test(t) ? t : undefined);
  if (!name) return false;
  const d = src.declOf(name, at);
  return d !== undefined && INTEGER_TYPE.test(d.type) && !FLOAT_TYPE.test(d.type);
};
const isFloat = (src: Source, token: string, at: number): boolean => {
  const t = token.trim();
  if (/^-?\d*\.\d+f?$/.test(t)) return true;
  if (!/^[A-Za-z_]\w*$/.test(t)) return false;
  return FLOAT_TYPE.test(src.declOf(t, at)?.type ?? "");
};

const GAIN = /^(k_?[pid]|k[pid]_?\w*|gain\w*)$/i;
const PID_WORD = /\b(k_?[pid]\w*|error|err|derivative|integral|correction|turn|steer\w*|pid\w*)\b/i;
const INTEGRAL = /integr|iterm|errsum|sumerr|errorsum|accum/i;

export const delayInLoop: LintRule = {
  id: "lfr.delay-in-loop",
  title: "delay() in the control loop",
  check: ({ src }) =>
    calls(src, "delay").flatMap(({ at, args }) => {
      const fn = src.fnAt(at);
      if (!fn || fn.name === "setup") return [];
      const ms = evaluate(src, args[0] ?? "")[0];
      if (ms === undefined || ms < 5) return [];
      return [
        finding(
          src,
          "lfr.delay-in-loop",
          ms >= 20 ? "error" : "warning",
          src.lineOf(at),
          `delay(${String(ms)}) in ${fn.name}() stops the control loop for ${String(ms)} ms.`,
          "While delay() runs, nothing reads the sensors or corrects the motors; at 1 m/s the robot travels 1 mm per ms blind. Time things with millis() and let loop() run freely.",
        ),
      ];
    }),
};

export const integerPidMath: LintRule = {
  id: "lfr.integer-pid-math",
  title: "Integer arithmetic in the PID",
  check: ({ src }) => {
    const out: FirmwareFinding[] = [];
    for (const d of src.decls) {
      if (GAIN.test(d.name) && INTEGER_TYPE.test(d.type) && !FLOAT_TYPE.test(d.type)) {
        out.push(
          finding(
            src,
            "lfr.integer-pid-math",
            "warning",
            d.line,
            `The gain ${d.name} is an integer (${d.type}).`,
            "Gains usually need fractions (0.08, 2.5). An integer gain can only be 0, 1, 2…, which is far too coarse to tune. Make it a float.",
          ),
        );
      }
    }
    const lines = src.code.split("\n");
    let offset = 0;
    lines.forEach((line, i) => {
      if (PID_WORD.test(line) && /\bk_?[pid]\w*\b/i.test(line)) {
        for (const m of line.matchAll(/([A-Za-z_]\w*|\d+)\s*\/\s*([A-Za-z_]\w*|\d+)/g)) {
          if (isInt(src, m[1] ?? "", offset) && isInt(src, m[2] ?? "", offset)) {
            out.push(
              finding(
                src,
                "lfr.integer-pid-math",
                "warning",
                i + 1,
                `${m[0]} is integer division: the fraction is thrown away.`,
                "Integer division truncates (7 / 10 = 0), so small errors produce no correction at all and the robot weaves. Use float maths or scale before dividing.",
              ),
            );
            break;
          }
        }
      }
      offset += line.length + 1;
    });
    return out;
  },
};

export const integralNoClamp: LintRule = {
  id: "lfr.integral-no-clamp",
  title: "Integral term without a limit",
  check: ({ src }) => {
    const out: FirmwareFinding[] = [];
    const seen = new Set<string>();
    for (const m of src.code.matchAll(/\b([A-Za-z_]\w*)\s*(\+=|=\s*\1\s*\+)/g)) {
      const name = m[1] ?? "";
      if (!INTEGRAL.test(name) || seen.has(name)) continue;
      seen.add(name);
      const limited = new RegExp(
        String.raw`constrain\s*\(\s*${name}\b|\b${name}\s*=\s*(constrain|min|max)\s*\(|\b(min|max)\s*\(\s*${name}\b|if\s*\(\s*(abs\s*\()?\s*${name}\s*\)?\s*[<>]`,
      ).test(src.code);
      if (!limited) {
        out.push(
          finding(
            src,
            "lfr.integral-no-clamp",
            "warning",
            src.lineOf(m.index),
            `${name} accumulates without a limit.`,
            "On a long curve the integral keeps growing; when the line straightens it keeps pushing the robot off (windup). Clamp it, e.g. " +
              name +
              " = constrain(" +
              name +
              ", -LIMIT, LIMIT).",
          ),
        );
      }
    }
    return out;
  },
};

export const millisOverflow: LintRule = {
  id: "lfr.millis-overflow",
  title: "millis()/micros() comparisons that break at overflow",
  check: ({ src }) => {
    const out: FirmwareFinding[] = [];
    const add =
      /\b(millis|micros)\s*\(\s*\)\s*[<>]=?\s*[\w.]+\s*\+|[\w.]+\s*\+\s*[\w.]+\s*[<>]=?\s*\b(millis|micros)\s*\(\s*\)/g;
    for (const m of src.code.matchAll(add)) {
      out.push(
        finding(
          src,
          "lfr.millis-overflow",
          "warning",
          src.lineOf(m.index),
          "Comparing millis() against a sum breaks when the counter wraps.",
          "millis() wraps after ~49 days and micros() after ~70 minutes; `now > last + interval` then fails. Write `now - last >= interval` with unsigned long variables: unsigned subtraction handles the wrap.",
        ),
      );
    }
    for (const d of src.decls) {
      if (
        d.init &&
        /\b(millis|micros)\s*\(\s*\)/.test(d.init) &&
        !/unsigned\s+long|uint32_t/.test(d.type)
      ) {
        out.push(
          finding(
            src,
            "lfr.millis-overflow",
            "warning",
            d.line,
            `${d.name} stores ${/micros/.test(d.init) ? "micros()" : "millis()"} in a ${d.type}.`,
            "millis()/micros() return unsigned long; a smaller or signed type overflows early (an int holds only 32 seconds of millis()).",
          ),
        );
      }
    }
    return out;
  },
};

export const analogWriteRange: LintRule = {
  id: "lfr.analogwrite-range",
  title: "analogWrite values outside 0–255",
  check: ({ src }) =>
    calls(src, "analogWrite").flatMap(({ at, args }) => {
      const value = args[1] ?? "";
      const n = evaluate(src, value)[0];
      if (n !== undefined) {
        return n > 255 || n < 0
          ? [
              finding(
                src,
                "lfr.analogwrite-range",
                "error",
                src.lineOf(at),
                `analogWrite(…, ${String(n)}) is outside 0–255.`,
                "Values above 255 wrap around (256 → 0), so 'more power' becomes almost none.",
              ),
            ]
          : [];
      }
      const ids = [...value.matchAll(/\b([A-Za-z_]\w*)\b(?!\s*\()/g)]
        .map((m) => m[1] ?? "")
        .filter((id) => src.declOf(id, at) !== undefined);
      const limited = (id: string) =>
        new RegExp(
          String.raw`constrain\s*\(\s*${id}\b|\b${id}\s*=\s*(constrain|min|max)\s*\(|if\s*\(\s*${id}\s*>\s*255`,
        ).test(src.code);
      if (/constrain\s*\(|\bmin\s*\(/.test(value) || ids.length === 0 || ids.every(limited))
        return [];
      return [
        finding(
          src,
          "lfr.analogwrite-range",
          "warning",
          src.lineOf(at),
          `analogWrite(…, ${value}) isn't limited to 0–255.`,
          "Base speed plus a PID correction easily exceeds 255, and analogWrite wraps instead of saturating (300 becomes 44). constrain() the value first.",
        ),
      ];
    }),
};

export const pidStateLocal: LintRule = {
  id: "lfr.pid-state-local",
  title: "PID state that resets every loop",
  check: ({ src }) =>
    src.decls
      .filter(
        (d) =>
          d.local &&
          !d.isStatic &&
          d.fn !== "setup" &&
          /^(last|prev)|integral|errsum|sumerr/i.test(d.name) &&
          src.functions.find((f) => f.name === d.fn)?.line !== d.line,
      )
      .map((d) =>
        finding(
          src,
          "lfr.pid-state-local",
          "warning",
          d.line,
          `${d.name} is a local variable of ${d.fn ?? "a function"}(), so it starts over every call.`,
          "PID memory (last error, integral) must survive between loop passes. Declare it at file scope or as static.",
        ),
      ),
};

export const floatEquality: LintRule = {
  id: "lfr.float-equality",
  title: "Comparing floats with ==",
  check: ({ src }) => {
    const out: FirmwareFinding[] = [];
    for (const m of src.code.matchAll(
      /([A-Za-z_]\w*|-?\d*\.\d+f?)\s*(==|!=)\s*([A-Za-z_]\w*|-?\d*\.\d+f?)/g,
    )) {
      const at = m.index;
      if (isFloat(src, m[1] ?? "", at) || isFloat(src, m[3] ?? "", at)) {
        out.push(
          finding(
            src,
            "lfr.float-equality",
            "warning",
            src.lineOf(at),
            `${m[0]} compares floating-point values exactly.`,
            "Float results are rarely exactly equal; compare with a tolerance (fabs(a - b) < 0.001) or use integers.",
          ),
        );
      }
    }
    return out;
  },
};

export const noDerivative: LintRule = {
  id: "lfr.no-derivative",
  title: "P-only control",
  check: ({ src }) => {
    const kp = src.decls.find((d) => /^k_?p\w*$/i.test(d.name) && !d.local);
    if (!kp) return [];
    const kd = src.decls.find((d) => /^k_?d\w*$/i.test(d.name));
    const kdZero = kd?.init !== undefined && /^-?0*(\.0*)?f?$/.test(kd.init.trim());
    const usesDerivative = /\bk_?d\w*\s*\*|derivative|\b(last|prev)\w*err/i.test(src.code);
    if (kd && !kdZero && usesDerivative) return [];
    return [
      finding(
        src,
        "lfr.no-derivative",
        "warning",
        kd && kdZero ? kd.line : kp.line,
        kd && kdZero
          ? `${kd.name} is 0: this is a P-only controller.`
          : "There's a proportional gain but no derivative term.",
        "With P alone the robot overshoots the line and weaves (slowly at low Kp, violently at high Kp). A D term — Kd × (error − lastError) / dt — damps the swing.",
      ),
    ];
  },
};

export const hardcodedThreshold: LintRule = {
  id: "lfr.hardcoded-threshold",
  title: "Fixed sensor thresholds",
  check: ({ src }) => {
    const readers = new Set<string>();
    for (const m of src.code.matchAll(/\b([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*=\s*analogRead\s*\(/g))
      readers.add(m[1] ?? "");
    const out: FirmwareFinding[] = [];
    for (const m of src.code.matchAll(
      /\b(analogRead\s*\([^)]*\)|[A-Za-z_]\w*\s*(?:\[[^\]]*\])?)\s*([<>]=?)\s*(\d+)\b/g,
    )) {
      const lhs = (m[1] ?? "").replace(/\s*\[.*$/, "").trim();
      const n = Number(m[3]);
      if ((lhs.startsWith("analogRead") || readers.has(lhs)) && n >= 100 && n <= 4000) {
        out.push(
          finding(
            src,
            "lfr.hardcoded-threshold",
            "warning",
            src.lineOf(m.index),
            `The sensor reading is compared with a fixed ${String(n)}.`,
            "Readings depend on sensor height, ambient light and the track; a fixed threshold that works on your desk fails elsewhere. Calibrate: record each sensor's min and max and compare against the midpoint.",
          ),
        );
      }
    }
    return out;
  },
};

export const unguardedAverage: LintRule = {
  id: "lfr.unguarded-average",
  title: "Weighted average without a lost-line check",
  check: ({ src }) =>
    [...src.code.matchAll(/\/\s*(sum|total|denom\w*)\b/gi)].flatMap((m) => {
      const name = m[1] ?? "";
      const guarded = new RegExp(
        String.raw`\b${name}\s*(==|!=|<=?|>=?)\s*\d|if\s*\(\s*!?\s*${name}\s*\)`,
      ).test(src.code);
      return guarded
        ? []
        : [
            finding(
              src,
              "lfr.unguarded-average",
              "error",
              src.lineOf(m.index),
              `Division by ${name} with no check for zero.`,
              `When no sensor sees the line, ${name} is 0: integer division by zero has no defined result. Check it first and steer towards where the line was last seen.`,
            ),
          ];
    }),
};

export const pinMismatch: LintRule = {
  id: "lfr.pin-mismatch",
  title: "Pins in code that don't match the wiring",
  check: ({ src, pins }) => {
    if (!pins) return [];
    const out: FirmwareFinding[] = [];
    const base = pins.analogBase ?? 14;
    /** The line to blame for a pin argument: its constant's definition, else the call. */
    const blame = (expr: string, at: number) => {
      const name = /^([A-Za-z_]\w*)/.exec(expr.trim())?.[1];
      const d = name ? src.declOf(name, at) : undefined;
      return d && !d.local ? d.line : src.lineOf(at);
    };
    /** Pin values an argument can take: constants directly, or through a helper's parameter
     * (`setMotor(PWMA, …)` → `analogWrite(pwm, …)`), one level deep. */
    const valuesOf = (
      expr: string,
      at: number,
      fn: string,
    ): { n: number; at: number; expr: string; fn: string }[] => {
      const direct = evaluate(src, expr, base).map((n) => ({ n, at, expr, fn }));
      if (direct.length > 0) return direct;
      const owner = src.fnAt(at);
      const k = owner?.params.indexOf(expr.trim()) ?? -1;
      if (!owner || k < 0) return [];
      return calls(src, owner.name)
        .filter((c) => src.fnAt(c.at) !== owner)
        .flatMap((c) =>
          evaluate(src, c.args[k] ?? "", base).map((n) => ({
            n,
            at: c.at,
            expr: c.args[k] ?? "",
            fn,
          })),
        );
    };
    const used = (fns: string[]) =>
      fns.flatMap((fn) =>
        calls(src, fn).flatMap(({ at, args }) => valuesOf(args[0] ?? "", at, fn)),
      );
    const outputs = used(["analogWrite", "digitalWrite", "ledcAttach", "ledcAttachPin"]);
    const inputs = used(["analogRead", "digitalRead"]);
    const outPins = new Set(outputs.map((u) => pins.pinName(u.n)));
    const inPins = new Set(inputs.map((u) => pins.pinName(u.n)));
    const wiredOut = new Set(pins.driverInputs.map((d) => d.pin));
    const wiredIn = new Set(pins.sensorOutputs.map((s) => s.pin));
    const missingOut = pins.driverInputs.filter((d) => !outPins.has(d.pin));
    const seen = new Set<string>();
    for (const u of outputs) {
      const name = pins.pinName(u.n);
      if (u.fn !== "analogWrite" && u.fn !== "ledcAttach" && u.fn !== "ledcAttachPin") continue;
      if (!name || wiredOut.has(name) || seen.has(name)) continue;
      seen.add(name);
      const hint =
        missingOut.length > 0
          ? ` The driver inputs on pins your code never drives: ${missingOut.map((d) => `${d.label} on ${d.pin}`).join(", ")}.`
          : "";
      out.push(
        finding(
          src,
          "lfr.pin-mismatch",
          "error",
          blame(u.expr, u.at),
          `${u.fn} drives ${name}, which isn't wired to the motor driver.${hint}`,
          "The code and the wiring disagree, so a motor never gets its PWM signal. Change the pin constant to match the wiring (or rewire).",
        ),
      );
    }
    for (const u of inputs) {
      const name = pins.pinName(u.n);
      if (!name || wiredIn.has(name) || seen.has(name)) continue;
      seen.add(name);
      const unread = pins.sensorOutputs.filter((s) => !inPins.has(s.pin));
      out.push(
        finding(
          src,
          "lfr.pin-mismatch",
          "error",
          blame(u.expr, u.at),
          `${u.fn} reads ${name}, which isn't wired to a sensor.${unread.length > 0 ? ` Sensor outputs your code never reads: ${unread.map((s) => `${s.label} on ${s.pin}`).join(", ")}.` : ""}`,
          "The code reads a pin with nothing connected, so it sees noise instead of the line.",
        ),
      );
    }
    return out;
  },
};

export const RULES: LintRule[] = [
  delayInLoop,
  integerPidMath,
  integralNoClamp,
  millisOverflow,
  analogWriteRange,
  pidStateLocal,
  floatEquality,
  noDerivative,
  hardcodedThreshold,
  unguardedAverage,
  pinMismatch,
];

/** Lint a sketch. Findings sorted by line. */
export function lintSketch(
  text: string,
  opts: { file?: string; pins?: PinContext } = {},
): FirmwareFinding[] {
  const src = parseSource(text, opts.file ?? "sketch.ino");
  const ctx: LintContext = { src, ...(opts.pins ? { pins: opts.pins } : {}) };
  return RULES.flatMap((r) => r.check(ctx)).sort((a, b) => a.line - b.line);
}
