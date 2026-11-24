import type { SimEvent, SourceLoc } from "@linelab/schema";
import type { TrackField } from "../track/geometry.js";
import {
  channelIndex,
  type Outcome,
  type PackedTrace,
  type TraceChannel,
} from "../sim/simulation.js";

/** Everything the detectors look at. Firmware-only inputs are optional. */
export interface DetectInput {
  trace: PackedTrace;
  recordEveryMs: number;
  field: TrackField;
  /** Events the simulator itself raised (laps, brownout, off track, stuck). */
  simEvents: readonly SimEvent[];
  outcome: Outcome;
  /** Firmware: times (ms) the first wired sensor was sampled. */
  sampleTimesMs?: readonly number[];
  /** Emulated firmware: calls into the Arduino core that took long, and where they came from. */
  longCalls?: readonly { atMs: number; durationMs: number; loc?: SourceLoc }[];
  /** Emulated firmware: stretches with no sensor reads while the CPU stayed in the sketch. */
  stalls?: readonly { atMs: number; durationMs: number; loc?: SourceLoc }[];
  /** Firmware globals sampled every `recordEveryMs`. */
  watch?: { names: readonly string[]; samples: readonly (readonly number[])[] };
}

export type Detector = (input: DetectInput) => SimEvent[];

/** Thresholds, with units. */
export const LIMITS = {
  lineLostMs: 100,
  oscillationMinHz: 1.5,
  oscillationMinRmsMm: 3,
  oscillationSkipMs: 500,
  fastOscillationHz: 4,
  saturationDuty: 0.98,
  saturationRunMs: 300,
  saturationFraction: 0.3,
  missedTurnDeg: 60,
  blockingCallMs: 10,
  blockingErrorMs: 20,
  slowLoopMs: 20,
  jitterRatio: 0.5,
  stallMs: 300,
  wrongDirectionMs: 1000,
  wheelMovingRadS: 3,
  startSamples: 3,
  steeringWindowMs: 3000,
  steeringCorrelation: 0.3,
} as const;

/** Column accessor over a packed trace. */
function col(trace: PackedTrace, c: TraceChannel): Float64Array {
  const k = channelIndex(c);
  const out = new Float64Array(trace.count);
  for (let i = 0; i < trace.count; i++) out[i] = trace.data[i * trace.stride + k] ?? 0;
  return out;
}

/** Runs of consecutive samples where `pred` holds: [startIndex, endIndexExclusive]. */
function runs(n: number, pred: (i: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    const on = i < n && pred(i);
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      out.push([start, i]);
      start = -1;
    }
  }
  return out;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

export const lineLost: Detector = ({ trace, outcome }) => {
  const t = col(trace, "tMs");
  const seen = col(trace, "lineSeen");
  const out: SimEvent[] = [];
  for (const [a, b] of runs(trace.count, (i) => (seen[i] ?? 1) === 0)) {
    const t0 = t[a] ?? 0;
    const t1 = t[Math.min(b, trace.count - 1)] ?? t0;
    const recovered = b < trace.count;
    if (t1 - t0 < LIMITS.lineLostMs) continue;
    // A finished run that ends with no line under the sensors just ran past the end of the line.
    if (!recovered && outcome === "finished") continue;
    out.push({
      tMs: t0,
      type: "line_lost",
      severity: recovered ? "warning" : "error",
      data: { durationMs: Math.round(t1 - t0), recovered },
      message: recovered
        ? `No sensor saw the line for ${Math.round(t1 - t0)} ms before it was found again.`
        : "Every sensor lost the line and the robot never found it again. Add a recovery: when no sensor sees the line, keep turning towards the side where it was last seen.",
    });
    if (recovered)
      out.push({
        tMs: t1,
        type: "line_reacquired",
        severity: "info",
        data: {},
        message: "Line found again.",
      });
  }
  return out;
};

/** Dominant frequency of a signal (Hz) by a coarse DFT over 0.5–20 Hz. */
export function dominantFrequency(x: ArrayLike<number>, dtS: number): number {
  let best = 0;
  let bestP = -1;
  const n = x.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += (x[i] ?? 0) / n;
  for (let f = 0.5; f <= 20; f += 0.1) {
    let re = 0;
    let im = 0;
    const w = 2 * Math.PI * f * dtS;
    for (let i = 0; i < n; i++) {
      const v = (x[i] ?? 0) - mean;
      re += v * Math.cos(w * i);
      im -= v * Math.sin(w * i);
    }
    const p = re * re + im * im;
    if (p > bestP) {
      bestP = p;
      best = f;
    }
  }
  return Math.round(best * 10) / 10;
}

export const oscillation: Detector = ({ trace, recordEveryMs }) => {
  const t = col(trace, "tMs");
  const lat = col(trace, "lateralMm");
  const seen = col(trace, "lineSeen");
  // Only while the line is under the sensors, after the start transient.
  const xs: number[] = [];
  for (let i = 0; i < trace.count; i++)
    if ((t[i] ?? 0) >= LIMITS.oscillationSkipMs && (seen[i] ?? 0) > 0) xs.push(lat[i] ?? 0);
  if (xs.length * recordEveryMs < 2000) return [];
  let crossings = 0;
  let sign = 0;
  for (const v of xs) {
    const s = v > 1 ? 1 : v < -1 ? -1 : 0;
    if (s !== 0) {
      if (sign !== 0 && s !== sign) crossings++;
      sign = s;
    }
  }
  const seconds = (xs.length * recordEveryMs) / 1000;
  const crossHz = crossings / 2 / seconds;
  const rms = Math.sqrt(xs.reduce((a, v) => a + v * v, 0) / xs.length);
  if (crossHz < LIMITS.oscillationMinHz || rms < LIMITS.oscillationMinRmsMm) return [];
  const f = dominantFrequency(xs, recordEveryMs / 1000);
  const fast = f >= LIMITS.fastOscillationHz;
  return [
    {
      tMs: LIMITS.oscillationSkipMs,
      type: "oscillation",
      severity: "warning",
      data: {
        frequencyHz: f,
        crossingsHz: r1(crossHz),
        rmsMm: r1(rms),
        likely: fast ? "p_too_high" : "d_too_low",
      },
      message: fast
        ? `The robot wobbles across the line at about ${f} Hz (±${r1(rms)} mm). Fast oscillation usually means the P gain is too high for this robot (or the loop is too slow). Lower Kp, or add D.`
        : `The robot weaves across the line at about ${f} Hz (±${r1(rms)} mm). Slow weaving means too little damping: add or raise the D term.`,
    },
  ];
};

export const pwmSaturation: Detector = ({ trace }) => {
  const t = col(trace, "tMs");
  const out: SimEvent[] = [];
  for (const side of ["left", "right"] as const) {
    const p = col(trace, side === "left" ? "pwmLeft" : "pwmRight");
    let total = 0;
    for (let i = 0; i < trace.count; i++) if (Math.abs(p[i] ?? 0) >= LIMITS.saturationDuty) total++;
    const longest = runs(trace.count, (i) => Math.abs(p[i] ?? 0) >= LIMITS.saturationDuty)
      .map(([a, b]) => [a, (t[b - 1] ?? 0) - (t[a] ?? 0)] as const)
      .sort((x, y) => y[1] - x[1])[0];
    const fraction = trace.count > 0 ? total / trace.count : 0;
    if (
      (longest && longest[1] >= LIMITS.saturationRunMs) ||
      fraction >= LIMITS.saturationFraction
    ) {
      out.push({
        tMs: t[longest?.[0] ?? 0] ?? 0,
        type: "pwm_saturation",
        severity: "warning",
        data: {
          side,
          fraction: Math.round(fraction * 100) / 100,
          longestMs: Math.round(longest?.[1] ?? 0),
        },
        message: `The ${side} motor ran at full power ${Math.round(fraction * 100)} % of the time. Saturated outputs can't steer harder, so the controller loses authority in corners. Lower the base speed so there's headroom for corrections.`,
      });
    }
  }
  return out;
};

/** Heading change of the track (degrees) between arc lengths a and b. */
function turnDeg(field: TrackField, a: number, b: number): number {
  let total = 0;
  let prev = field.at(a).headingRad;
  for (let s = a + 10; s <= b; s += 10) {
    const h = field.at(s).headingRad;
    total += Math.atan2(Math.sin(h - prev), Math.cos(h - prev));
    prev = h;
  }
  return (total * 180) / Math.PI;
}

export const missedTurn: Detector = (input) => {
  const { trace, field, simEvents } = input;
  const L = field.path.length;
  const t = col(trace, "tMs");
  const prog = col(trace, "progressMm");
  const progressAt = (tMs: number) => {
    let i = 0;
    while (i + 1 < trace.count && (t[i + 1] ?? 0) <= tMs) i++;
    return prog[i] ?? 0;
  };
  const failures = [
    ...simEvents.filter((e) => e.type === "off_track"),
    ...lineLost(input).filter((e) => e.type === "line_lost" && e.severity === "error"),
  ];
  const first = failures.sort((a, b) => a.tMs - b.tMs)[0];
  if (!first) return [];
  const s = ((progressAt(first.tMs) % L) + L) % L;
  const deg = turnDeg(field, Math.max(0, s - 60), Math.min(L, s + 120));
  if (Math.abs(deg) < LIMITS.missedTurnDeg) return [];
  return [
    {
      tMs: first.tMs,
      type: "missed_turn",
      severity: "error",
      data: { turnDeg: Math.round(deg), atMm: Math.round(s) },
      message: `The robot lost the line at a ${Math.abs(Math.round(deg))}° ${deg > 0 ? "left" : "right"} turn. It arrived too fast or couldn't steer hard enough: slow down when the error grows, allow one wheel to reverse, or raise the steering gain.`,
    },
  ];
};

export const blockingDelay: Detector = ({ longCalls, sampleTimesMs }) => {
  const out: SimEvent[] = [];
  const byLine = new Map<string, { atMs: number; maxMs: number; count: number; loc?: SourceLoc }>();
  for (const c of longCalls ?? []) {
    if (c.durationMs < LIMITS.blockingCallMs) continue;
    const k = c.loc ? `${c.loc.file}:${String(c.loc.line)}` : "?";
    const e = byLine.get(k);
    if (e) {
      e.count++;
      e.maxMs = Math.max(e.maxMs, c.durationMs);
    } else
      byLine.set(k, {
        atMs: c.atMs,
        maxMs: c.durationMs,
        count: 1,
        ...(c.loc ? { loc: c.loc } : {}),
      });
  }
  for (const e of byLine.values()) {
    out.push({
      tMs: e.atMs,
      type: "blocking_delay",
      severity: e.maxMs >= LIMITS.blockingErrorMs ? "error" : "warning",
      data: { durationMs: r1(e.maxMs), count: e.count },
      message: `A call here blocks for ${r1(e.maxMs)} ms (${e.count}×). The robot drives blind meanwhile: at 1 m/s that's ${Math.round(e.maxMs)} mm without a sensor reading. Use millis() timing instead of delay() in the control loop.`,
      ...(e.loc ? { sourceLoc: e.loc } : {}),
    });
  }
  if (out.length === 0 && sampleTimesMs && sampleTimesMs.length > 20) {
    const gaps = sampleTimesMs.slice(1).map((v, i) => v - (sampleTimesMs[i] ?? v));
    const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0;
    if (median >= LIMITS.slowLoopMs) {
      out.push({
        tMs: sampleTimesMs[0] ?? 0,
        type: "blocking_delay",
        severity: "warning",
        data: { loopMs: r1(median) },
        message: `The control loop takes ${r1(median)} ms per pass. Below ~100 Hz a line follower reacts late to curves.`,
      });
    }
  }
  return out;
};

export const controlLoopJitter: Detector = ({ sampleTimesMs }) => {
  if (!sampleTimesMs || sampleTimesMs.length < 50) return [];
  const gaps = sampleTimesMs
    .slice(1)
    .map((v, i) => v - (sampleTimesMs[i] ?? v))
    .sort((a, b) => a - b);
  const q = (f: number) => gaps[Math.min(gaps.length - 1, Math.floor(f * gaps.length))] ?? 0;
  const median = q(0.5);
  if (median <= 0) return [];
  const spread = (q(0.95) - q(0.05)) / median;
  if (spread < LIMITS.jitterRatio) return [];
  return [
    {
      tMs: sampleTimesMs[0] ?? 0,
      type: "control_loop_jitter",
      severity: "warning",
      data: { medianMs: r1(median), p5Ms: r1(q(0.05)), p95Ms: r1(q(0.95)) },
      message: `The loop period varies a lot (${r1(q(0.05))}–${r1(q(0.95))} ms around ${r1(median)} ms). A PID tuned for one period behaves differently at another; compute D and I with the measured dt, or run the loop on a fixed schedule.`,
    },
  ];
};

export const infiniteLoop: Detector = ({ stalls }) =>
  (stalls ?? [])
    .filter((s) => s.durationMs >= LIMITS.stallMs)
    .slice(0, 1)
    .map((s) => ({
      tMs: s.atMs,
      type: "infinite_loop" as const,
      severity: "error" as const,
      data: { durationMs: Math.round(s.durationMs) },
      message: `The firmware stopped reading sensors for ${Math.round(s.durationMs)} ms while running here: it's stuck in a loop that never exits.`,
      ...(s.loc ? { sourceLoc: s.loc } : {}),
    }));

export const integratorWindup: Detector = ({ watch, recordEveryMs }) => {
  if (!watch) return [];
  const out: SimEvent[] = [];
  watch.names.forEach((name, k) => {
    if (!/integr|iterm|errsum|sumerr|errorsum|accum/i.test(name)) return;
    const xs = watch.samples[k] ?? [];
    const win = Math.round(1000 / recordEveryMs);
    // Growing in each of two consecutive seconds: ramping up to a clamp grows only once.
    const grew = (i: number) => {
      const a = Math.abs(xs[i - win] ?? 0);
      const b = Math.abs(xs[i] ?? 0);
      let up = 0;
      for (let j = i - win + 1; j <= i; j++)
        if (Math.abs(xs[j] ?? 0) > Math.abs(xs[j - 1] ?? 0)) up++;
      return b > 2 * a + 100 && up >= 0.9 * win;
    };
    for (let i = 2 * win; i < xs.length; i += win) {
      if (grew(i - win) && grew(i)) {
        const from = Math.abs(xs[i - 2 * win] ?? 0);
        const to = Math.abs(xs[i] ?? 0);
        out.push({
          tMs: (i - 2 * win) * recordEveryMs,
          type: "integrator_windup",
          severity: "warning",
          data: { variable: name, from, to },
          message: `${name} keeps growing (${Math.round(from)} → ${Math.round(to)} in 2 s). An unclamped integral keeps pushing after the error is gone and overshoots the line. Clamp it with constrain().`,
        });
        return;
      }
    }
  });
  return out;
};

export const wrongDirection: Detector = ({ trace }) => {
  const t = col(trace, "tMs");
  const wl = col(trace, "wheelLeftRadS");
  const wr = col(trace, "wheelRightRadS");
  const prog = col(trace, "progressMm");
  const M = LIMITS.wheelMovingRadS;
  // At the start the robot sits straight on the line, so any sane controller's first commands
  // drive both wheels forward. If the first few active samples have a wheel going backwards, that
  // motor's "forward" is reversed (or both are, if both go backwards).
  const pl = col(trace, "pwmLeft");
  const pr = col(trace, "pwmRight");
  const active: number[] = [];
  for (let i = 0; i < trace.count && active.length < LIMITS.startSamples; i++) {
    if (Math.abs(pl[i] ?? 0) > 0.15 && Math.abs(pr[i] ?? 0) > 0.15) active.push(i);
  }
  if (active.length === LIMITS.startSamples) {
    const leftBack = active.every((i) => (pl[i] ?? 0) < 0);
    const rightBack = active.every((i) => (pr[i] ?? 0) < 0);
    if (leftBack || rightBack) {
      const wheel = leftBack && rightBack ? "both" : leftBack ? "left" : "right";
      return [
        {
          tMs: t[active[0] ?? 0] ?? 0,
          type: "wrong_direction",
          severity: "error",
          data: { wheel, atStart: true },
          message:
            wheel === "both"
              ? "Right at the start, with the robot straight on the line, both motors were driven backwards. The motors' direction is reversed: swap IN1/IN2 (DIR) in code or swap the motor wires."
              : `Right at the start, with the robot straight on the line, the ${wheel} motor was driven backwards while the other went forwards. That motor's direction is reversed: swap its IN1/IN2 (DIR) logic in code, or swap its two wires.`,
        },
      ];
    }
  }
  for (const [a, b] of runs(
    trace.count,
    (i) =>
      Math.abs(wl[i] ?? 0) > M &&
      Math.abs(wr[i] ?? 0) > M &&
      Math.sign(wl[i] ?? 0) !== Math.sign(wr[i] ?? 0),
  )) {
    const dur = (t[b - 1] ?? 0) - (t[a] ?? 0);
    const progress = Math.abs((prog[b - 1] ?? 0) - (prog[a] ?? 0));
    if (dur >= LIMITS.wrongDirectionMs && progress < 50) {
      const backward = (wl[a] ?? 0) < 0 ? "left" : "right";
      return [
        {
          tMs: t[a] ?? 0,
          type: "wrong_direction",
          severity: "error",
          data: { wheel: backward, durationMs: Math.round(dur) },
          message: `The ${backward} wheel kept turning backwards while the other went forwards, so the robot spun in place for ${(dur / 1000).toFixed(1)} s. That motor's direction is reversed: swap its two wires, or swap its IN1/IN2 (DIR) logic in code.`,
        },
      ];
    }
  }
  return [];
};

export const steeringInverted: Detector = ({ trace, simEvents }) => {
  const t = col(trace, "tMs");
  const lat = col(trace, "lateralMm");
  const om = col(trace, "omegaRadS");
  const seen = col(trace, "lineSeen");
  const lostEarly = simEvents.some(
    (e) => e.type === "off_track" && e.tMs <= LIMITS.steeringWindowMs + 1500,
  );
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < trace.count; i++) {
    if ((t[i] ?? 0) > LIMITS.steeringWindowMs) break;
    if ((seen[i] ?? 0) === 0) continue;
    xs.push(lat[i] ?? 0);
    ys.push(om[i] ?? 0);
  }
  if (xs.length < 20) return [];
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  xs.forEach((x, i) => {
    const dx = x - mx;
    const dy = (ys[i] ?? 0) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  });
  const corr = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  // Correct steering turns towards the line: line to the right (lateral > 0) → turn right (ω < 0).
  if (corr < LIMITS.steeringCorrelation || !lostEarly) return [];
  return [
    {
      tMs: 0,
      type: "steering_inverted",
      severity: "error",
      data: { correlation: Math.round(corr * 100) / 100 },
      message:
        "The robot turns away from the line instead of towards it. The sensor order (which side is sensor 1) or the steering sign is reversed in the code.",
    },
  ];
};

/** Simulator events worth explaining, passed through with a message. */
const passThrough: Detector = ({ simEvents }) =>
  simEvents
    .filter((e) => ["brownout", "off_track", "stuck", "lap_complete"].includes(e.type))
    .map((e) => ({
      ...e,
      message:
        e.message ??
        (e.type === "brownout"
          ? "The battery voltage sagged below what the microcontroller needs and it reset. Use a battery that can deliver the motors' current, add a capacitor, or slow down."
          : e.type === "off_track"
            ? "The robot ended up far from the line and the run was stopped."
            : e.type === "stuck"
              ? "The robot stopped making progress along the track for 3 s (stalled, circling or spinning in place)."
              : "Lap complete."),
    }));

export const DETECTORS: Record<string, Detector> = {
  passThrough,
  lineLost,
  oscillation,
  pwmSaturation,
  missedTurn,
  blockingDelay,
  controlLoopJitter,
  infiniteLoop,
  integratorWindup,
  wrongDirection,
  steeringInverted,
};

/** Run every detector; events sorted by time. */
export function detect(input: DetectInput): SimEvent[] {
  let events = Object.values(DETECTORS).flatMap((d) => d(input));
  // Inverted steering makes the robot spin, which also looks like a reversed motor; report the cause.
  if (events.some((e) => e.type === "steering_inverted"))
    events = events.filter((e) => !(e.type === "wrong_direction" && e.data.atStart !== true));
  return events.sort((a, b) => a.tMs - b.tMs);
}
