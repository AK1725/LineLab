/**
 * @linelab/run-report: everything one run tells you, in one place.
 * - failure events from the sim-core detectors, each with a plain-language message and, where
 *   possible, the source line responsible: exact (measured from the program counter) for blocking
 *   calls and stalls, "likely" (found by pattern) for the rest;
 * - LineLab's line-follower lint findings on the sketch, with the design's wiring;
 * - outcome and metrics.
 */
import {
  evaluate,
  lintSketch,
  parseSource,
  type PinContext,
  type Source,
} from "@linelab/firmware-lint";
import {
  EMULATED_BOARDS,
  halPinNumber,
  type FirmwareRun,
  type FirmwareWiring,
} from "@linelab/firmware-runtime";
import type { FirmwareFinding, RunMetrics, SimEvent, SourceLoc } from "@linelab/schema";
import { detect, type SimResult, type TrackField } from "@linelab/sim-core";

export interface RunReport {
  outcome: SimResult["outcome"];
  metrics: RunMetrics;
  events: SimEvent[];
  lint: FirmwareFinding[];
  counts: { errors: number; warnings: number };
}

/** What the wiring means for pin numbers in code. */
export function pinContextFor(wiring: FirmwareWiring): PinContext {
  const avr = EMULATED_BOARDS.has(wiring.mcu.id);
  const byNumber = new Map<number, string>();
  for (const p of wiring.mcu.pins) {
    const n = avr
      ? /^D(\d+)$/.exec(p.id)
        ? Number(p.id.slice(1))
        : /^A(\d)$/.exec(p.id)
          ? 14 + Number(p.id.slice(1))
          : undefined
      : halPinNumber(p.id);
    if (n !== undefined && !byNumber.has(n)) byNumber.set(n, p.id);
  }
  const driverInputs = wiring.motors.flatMap((m) =>
    Object.entries(m.inputs).flatMap(([pin, src]) =>
      src.kind === "mcu" ? [{ pin: src.pin, label: `${pin} (${m.side} motor)` }] : [],
    ),
  );
  const sensorOutputs = wiring.sensors.flatMap((s) =>
    s.mcuPin ? [{ pin: s.mcuPin, label: `sensor ${String(s.index + 1)}` }] : [],
  );
  return {
    pinName: (n) => byNumber.get(n),
    analogBase: avr ? 14 : undefined,
    driverInputs,
    sensorOutputs,
  };
}

const BLOCKING_CALL = /\b(delay|delayMicroseconds|pulseIn)\s*\(/;

const lineMatching = (src: Source, re: RegExp, exclude?: RegExp): number | undefined => {
  const lines = src.code.split("\n");
  const i = lines.findIndex((l) => re.test(l) && !(exclude?.test(l) ?? false));
  return i >= 0 ? i + 1 : undefined;
};
const declLine = (src: Source, re: RegExp) =>
  src.decls.find((d) => !d.local && re.test(d.name))?.line;

/**
 * The line most likely responsible for an event, by pattern. Returns undefined when nothing fits
 * (better no line than a wrong one).
 */
export function locate(e: SimEvent, src: Source, wiring?: FirmwareWiring): number | undefined {
  switch (e.type) {
    case "oscillation":
      return e.data.likely === "d_too_low"
        ? (declLine(src, /^k_?d\w*$/i) ?? declLine(src, /^k_?p\w*$/i))
        : declLine(src, /^k_?p\w*$/i);
    case "pwm_saturation":
    case "missed_turn":
      return (
        declLine(src, /^(base\w*|speed|max_?speed)$/i) ?? lineMatching(src, /\banalogWrite\s*\(/)
      );
    case "integrator_windup": {
      const v = typeof e.data.variable === "string" ? e.data.variable : "integral";
      return lineMatching(src, new RegExp(String.raw`\b${v}\s*\+=`));
    }
    case "steering_inverted":
      return lineMatching(
        src,
        /\b(weight\w*|position|pos)\s*\+=|\*\s*\(\s*\d+L?\s*\*\s*i\s*-|\*\s*\(\s*\d+\s*-\s*\d+L?\s*\*\s*i/,
      );
    case "line_lost":
      // Only blame the lost-line branch when it doesn't steer (sets the error to a constant 0).
      if (e.severity !== "error") return undefined;
      return (
        lineMatching(src, /if\s*\(\s*!?\s*lost\b[^;]*=\s*0\s*;/) ??
        lineMatching(src, /\b(sum|total)\s*(<|<=|==)\s*\d+[^;]*\berr\w*\s*=\s*0\s*;/)
      );
    case "wrong_direction": {
      const m = wiring?.motors.find((x) => x.side === e.data.wheel);
      if (!m) return undefined;
      const ctx = wiring ? pinContextFor(wiring) : undefined;
      const dirPins = new Set(
        [m.channel.pins.in1, m.channel.pins.in2, m.channel.pins.phase].flatMap((p) => {
          const s = p ? m.inputs[p] : undefined;
          return s?.kind === "mcu" ? [s.pin] : [];
        }),
      );
      // Constants whose value is one of those pins.
      const names = src.decls
        .filter(
          (d) =>
            !d.local &&
            evaluate(src, d.name, ctx?.analogBase ?? 14).some((n) =>
              dirPins.has(ctx?.pinName(n) ?? ""),
            ),
        )
        .map((d) => d.name);
      if (names.length === 0) return undefined;
      const any = new RegExp(String.raw`\b(${names.join("|")})\b`);
      return (
        lineMatching(
          src,
          new RegExp(String.raw`\(.*\b(${names.join("|")})\b.*,.*\b(${names.join("|")})\b`),
          /pinMode/,
        ) ?? lineMatching(src, new RegExp(String.raw`digitalWrite\s*\(\s*${any.source}`))
      );
    }
    default:
      return undefined;
  }
}

/** Build the report for one run. `firmware` is omitted for reference-controller runs. */
export function buildRunReport(args: {
  result: SimResult;
  field: TrackField;
  recordEveryMs: number;
  firmware?: {
    run: Pick<FirmwareRun, "sampleTimesMs" | "longCalls" | "stalls" | "watchSeries" | "wiring">;
    source: string;
    file: string;
  };
}): RunReport {
  const fw = args.firmware;
  const events = detect({
    trace: args.result.trace,
    recordEveryMs: args.recordEveryMs,
    field: args.field,
    simEvents: args.result.events,
    outcome: args.result.outcome,
    ...(fw
      ? { sampleTimesMs: fw.run.sampleTimesMs, longCalls: fw.run.longCalls, stalls: fw.run.stalls }
      : {}),
    ...(fw?.run.watchSeries ? { watch: fw.run.watchSeries } : {}),
  });
  let lint: FirmwareFinding[] = [];
  if (fw) {
    const src = parseSource(fw.source, fw.file);
    const lines = src.code.split("\n");
    const blocking = events.some((e) => e.type === "blocking_delay" && e.severity === "error");
    for (const e of events) {
      if (e.sourceLoc) {
        // Exact locations come from the line table, named after the compiled file; show the sketch.
        if (e.sourceLoc.file.endsWith(".ino")) e.sourceLoc = { ...e.sourceLoc, file: fw.file };
        // With link-time inlining the last sketch instruction before a blocking call can belong to
        // the previous (inlined) statement. If that line has no blocking call, use the next one.
        if (e.type === "blocking_delay" && !BLOCKING_CALL.test(lines[e.sourceLoc.line - 1] ?? "")) {
          const from = e.sourceLoc.line;
          const next = lines.findIndex(
            (l, i) =>
              i + 1 >= from &&
              BLOCKING_CALL.test(l) &&
              src.fnAt(src.code.indexOf(l))?.name !== "setup",
          );
          if (next >= 0) e.sourceLoc = { file: fw.file, line: next + 1, exact: false };
        }
        continue;
      }
      if (e.type === "oscillation" && blocking) {
        // The slow loop is the cause; don't point at the gains.
        e.message = `${e.message ?? ""} Here the blocking call in the loop (see above) is the likely cause: the controller only reacts every few tens of ms.`;
        continue;
      }
      const line = locate(e, src, fw.run.wiring);
      if (line !== undefined)
        e.sourceLoc = { file: fw.file, line, exact: false } satisfies SourceLoc;
    }
    lint = lintSketch(fw.source, { file: fw.file, pins: pinContextFor(fw.run.wiring) });
  }
  const all = [...events.map((e) => e.severity), ...lint.map((f) => f.severity)];
  return {
    outcome: args.result.outcome,
    metrics: args.result.metrics,
    events,
    lint,
    counts: {
      errors: all.filter((s) => s === "error").length,
      warnings: all.filter((s) => s === "warning").length,
    },
  };
}
