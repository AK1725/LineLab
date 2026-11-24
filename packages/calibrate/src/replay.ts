import type { TelemetryRecording } from "@linelab/schema";
import {
  NOMINAL,
  Simulation,
  TRACE_CHANNELS,
  column,
  type Controller,
  type RobotModel,
  type SimConfig,
  type TrackField,
} from "@linelab/sim-core";

/** How a simulated run compares to a recording, over a time window after motion starts. */
export interface TraceComparison {
  /** Combined error (RMS of normalised sensor and PWM differences, plus the noise term). */
  error: number;
  sensorRms: number;
  pwmRms: number;
  /** |high-pass noise level, sim − real|, as a fraction of full scale. */
  noiseGap: number;
  samples: number;
}

export interface ReplayContext {
  recording: TelemetryRecording;
  field: TrackField;
  makeController: () => Controller;
  /** Compare samples from `fromMs` to `toMs` after the robot starts moving. */
  fromMs: number;
  toMs: number;
  /** Sim seed (sensor-noise realisation). */
  seed?: number;
  config?: Partial<SimConfig>;
  /** Low-pass half-width for the pointwise comparison (ms, default 40). */
  smoothMs?: number;
  /** Weight of PWM error relative to sensor error (default 1). */
  pwmWeight?: number;
}

const MOVING = 0.02;

/** Time (ms) of the first sample with a motor command, i.e. when the run really starts. */
export function motionStartMs(
  times: ArrayLike<number>,
  l: ArrayLike<number>,
  r: ArrayLike<number>,
) {
  for (let i = 0; i < times.length; i++)
    if (Math.abs(l[i] ?? 0) > MOVING || Math.abs(r[i] ?? 0) > MOVING) return times[i] ?? 0;
  return times[0] ?? 0;
}

/** High-pass noise level: RMS of x[i] − (x[i−1] + x[i+1])/2, over channels. */
function noiseLevel(rows: number[][]): number {
  let s = 0;
  let n = 0;
  for (let i = 1; i + 1 < rows.length; i++) {
    const a = rows[i - 1] ?? [];
    const b = rows[i] ?? [];
    const c = rows[i + 1] ?? [];
    for (let k = 0; k < b.length; k++) {
      s += ((b[k] ?? 0) - ((a[k] ?? 0) + (c[k] ?? 0)) / 2) ** 2;
      n++;
    }
  }
  return n ? Math.sqrt(s / n / 1.5) : 0;
}

/** Simulate `robot` with the recording's controller and compare it to the recording. */
export function compareToRecording(robot: RobotModel, ctx: ReplayContext): TraceComparison {
  const rec = ctx.recording;
  const recT = rec.samples.map((s) => s.tMs);
  const t0r = motionStartMs(
    recT,
    rec.samples.map((s) => s.pwmLeft),
    rec.samples.map((s) => s.pwmRight),
  );
  const sim = new Simulation(robot, ctx.field, ctx.makeController(), {
    variation: NOMINAL,
    ...ctx.config,
    seed: ctx.seed ?? 1,
    recordEveryMs: 1,
    durationMs: Math.ceil(ctx.toMs + 2000),
  });
  const r = sim.run();
  const tr = r.trace;
  const t = column(tr, "tMs");
  const pl = column(tr, "pwmLeft");
  const pr = column(tr, "pwmRight");
  const t0s = motionStartMs(t, pl, pr);
  const s0 = TRACE_CHANNELS.length;
  const adcMax = 2 ** robot.logic.adcBits - 1;
  const n = Math.min(tr.sensorCount, rec.sensorCount || tr.sensorCount);
  const pwmW = ctx.pwmWeight ?? 1;

  // Recorded samples in the window, and the sim rows they map to for a clock offset (ms). The
  // motion-start estimate is only good to one telemetry period, so the offset that fits best
  // within ±periodMs is used.
  const win = rec.samples.filter((s) => {
    const rel = s.tMs - t0r;
    return rel >= ctx.fromMs && rel <= ctx.toMs;
  });
  if (win.length === 0)
    return { error: Infinity, sensorRms: Infinity, pwmRms: Infinity, noiseGap: 0, samples: 0 };
  // Compare low-passed signals (±smoothMs): controllers amplify sensor noise into PWM jitter
  // that no twin can (or should) reproduce sample by sample.
  const half = Math.max(0, Math.round((ctx.smoothMs ?? 40) / Math.max(1, rec.periodMs)));
  const smooth = (xs: number[]) =>
    xs.map((_, k) => {
      let a = 0;
      let m = 0;
      for (let j = Math.max(0, k - half); j <= Math.min(xs.length - 1, k + half); j++) {
        a += xs[j] ?? 0;
        m++;
      }
      return a / m;
    });
  const realRaw = win.map((s) => s.sensors.slice(0, n).map((v) => v / adcMax));
  const realCols = Array.from({ length: n }, (_, c) => smooth(realRaw.map((r) => r[c] ?? 0)));
  const realRows = win.map((_, k) => realCols.map((col) => col[k] ?? 0));
  const realL = smooth(win.map((s) => s.pwmLeft));
  const realR = smooth(win.map((s) => s.pwmRight));
  // Prefix sums of the 1 ms sim columns, for window means.
  const halfMs = half * rec.periodMs;
  const prefix = (get: (i: number) => number) => {
    const p = new Float64Array(tr.count + 1);
    for (let i = 0; i < tr.count; i++) p[i + 1] = (p[i] ?? 0) + get(i);
    return p;
  };
  const simCols = [
    ...Array.from({ length: n }, (_, c) =>
      prefix((i) => (tr.data[i * tr.stride + s0 + c] ?? 0) / adcMax),
    ),
    prefix((i) => pl[i] ?? 0),
    prefix((i) => pr[i] ?? 0),
  ];
  const meanAt = (col: Float64Array, i: number) => {
    const a = Math.max(0, i - halfMs);
    const b = Math.min(tr.count - 1, i + halfMs);
    return ((col[b + 1] ?? 0) - (col[a] ?? 0)) / (b - a + 1);
  };
  const rowAt = (s: { tMs: number }, shift: number) =>
    Math.min(tr.count - 1, Math.max(0, Math.round(t0s + s.tMs - t0r + shift - (t[0] ?? 0))));
  const errorsAt = (shift: number) => {
    let sens = 0;
    let pwm = 0;
    win.forEach((_, k) => {
      // Past the end of the run (the sim robot went off track or got stuck) its last state is
      // compared, which is what makes a bad twin expensive.
      const i = rowAt(win[k] ?? { tMs: 0 }, shift);
      const real = realRows[k] ?? [];
      let e = 0;
      for (let c = 0; c < n; c++)
        e += (meanAt(simCols[c] ?? new Float64Array(1), i) - (real[c] ?? 0)) ** 2;
      sens += e / Math.max(1, n);
      const dl = meanAt(simCols[n] ?? new Float64Array(1), i) - (realL[k] ?? 0);
      const dr = meanAt(simCols[n + 1] ?? new Float64Array(1), i) - (realR[k] ?? 0);
      pwm += (dl * dl + dr * dr) / 2;
    });
    return { sens, pwm, total: sens + pwmW * pwm };
  };
  const period = Math.max(1, Math.round(rec.periodMs));
  let bestShift = 0;
  let best = errorsAt(0);
  for (let sh = -period; sh <= period; sh++) {
    const e = errorsAt(sh);
    if (e.total < best.total) {
      best = e;
      bestShift = sh;
    }
  }
  const { sens, pwm } = best;
  const count = win.length;
  const simRows = win.map((s) => {
    const i = rowAt(s, bestShift);
    return Array.from({ length: n }, (_, c) => (tr.data[i * tr.stride + s0 + c] ?? 0) / adcMax);
  });
  const sensorRms = Math.sqrt(sens / count);
  const pwmRms = Math.sqrt(pwm / count);
  const noiseGap = Math.abs(noiseLevel(simRows) - noiseLevel(realRaw));
  const error = Math.sqrt(sensorRms ** 2 + pwmW * pwmRms ** 2 + noiseGap ** 2);
  return { error, sensorRms, pwmRms, noiseGap, samples: count };
}
