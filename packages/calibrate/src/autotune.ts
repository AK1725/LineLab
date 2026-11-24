import type { Track } from "@linelab/schema";
import {
  DEFAULT_PID,
  Prng,
  ReferencePid,
  SIM_FIELD,
  TrackField,
  runMonteCarlo,
  type MonteCarloResult,
  type ReferencePidOptions,
  type RobotModel,
  type SimConfig,
} from "@linelab/sim-core";
import { bayesOpt, latinHypercube } from "./bayesopt.js";

export type PidKey = "kp" | "kd" | "ki" | "baseDuty" | "cornerSlowdown";

export interface TuneRange {
  key: PidKey;
  lo: number;
  hi: number;
  /** Search on a log scale (gains spanning orders of magnitude). */
  log?: boolean;
}

export const DEFAULT_TUNE_RANGES: readonly TuneRange[] = [
  { key: "kp", lo: 0.3, hi: 4, log: true },
  { key: "kd", lo: 0.005, hi: 0.15, log: true },
  { key: "baseDuty", lo: 0.25, hi: 0.85 },
  { key: "cornerSlowdown", lo: 0, hi: 0.85 },
];

const fromUnit = (r: TuneRange, u: number) =>
  r.log ? r.lo * (r.hi / r.lo) ** u : r.lo + u * (r.hi - r.lo);
const toUnit = (r: TuneRange, v: number) =>
  r.log ? Math.log(v / r.lo) / Math.log(r.hi / r.lo) : (v - r.lo) / (r.hi - r.lo);

export interface TuneScore {
  robustness: number;
  meanLapTimeMs: number | undefined;
}

export interface AutotuneResult {
  baseline: { pid: ReferencePidOptions; tuning: TuneScore; heldOut: TuneScore };
  /** The best candidate found. Only use it when `improved` is true. */
  best: { pid: ReferencePidOptions; tuning: TuneScore; heldOut: TuneScore };
  /** True when the best candidate is faster on held-out seeds and no less robust on either set. */
  improved: boolean;
  history: { pid: Partial<ReferencePidOptions>; f: number; score: TuneScore }[];
}

const score = (m: MonteCarloResult): TuneScore => ({
  robustness: m.robustness,
  meanLapTimeMs: m.meanLapTimeMs,
});

/**
 * PID auto-tuner (BLUEPRINT §2.2 F): Bayesian optimisation over the reference controller's gains
 * and speed on the (calibrated) robot. Objective: mean lap time over Monte Carlo seeds, with a
 * steep penalty for any loss of robustness against the starting gains. The winner is re-checked
 * on held-out seeds; if it isn't better there, the result says so (`improved: false`).
 */
export function autotunePid(args: {
  robot: RobotModel;
  track: Track;
  start?: Partial<ReferencePidOptions>;
  ranges?: readonly TuneRange[];
  seeds?: readonly number[];
  heldOutSeeds?: readonly number[];
  iterations?: number;
  seed?: number;
  config?: Partial<SimConfig>;
  onEval?: (e: { index: number; total: number; best: number }) => void;
}): AutotuneResult {
  const ranges = args.ranges ?? DEFAULT_TUNE_RANGES;
  const seeds = args.seeds ?? [0, 1, 2, 3];
  const held = args.heldOutSeeds ?? [11, 12, 13, 14, 15, 16];
  const field = new TrackField(args.track, SIM_FIELD);
  const start: ReferencePidOptions = { ...DEFAULT_PID, ...args.start };
  const evaluate = (pid: ReferencePidOptions, s: readonly number[]) =>
    score(runMonteCarlo(args.robot, field, () => new ReferencePid(pid), s, args.config));
  const base = evaluate(start, seeds);
  const worstLapS = 3 * ((base.meanLapTimeMs ?? 60_000) / 1000);
  const objective = (sc: TuneScore) => {
    const lapS = sc.meanLapTimeMs !== undefined ? sc.meanLapTimeMs / 1000 : worstLapS;
    return lapS + Math.max(0, base.robustness - sc.robustness) * worstLapS * 2;
  };
  const pidOf = (u: readonly number[]): ReferencePidOptions => {
    const p: ReferencePidOptions = { ...start };
    ranges.forEach((r, i) => {
      p[r.key] = Math.round(fromUnit(r, u[i] ?? 0) * 1e4) / 1e4;
    });
    return p;
  };
  const iterations = args.iterations ?? 22;
  const initialN = 2 * ranges.length + 2;
  const history: AutotuneResult["history"] = [];
  // Start the search from the user's gains plus a space-filling design.
  const startU = ranges.map((r) => Math.min(1, Math.max(0, toUnit(r, start[r.key]))));
  const lhs = latinHypercube(initialN - 1, ranges.length, new Prng((args.seed ?? 1) ^ 0x5bd1e995));
  const bo = bayesOpt(
    (u) => {
      const pid = pidOf(u);
      const sc = evaluate(pid, seeds);
      const f = objective(sc);
      history.push({
        pid: Object.fromEntries(ranges.map((r) => [r.key, pid[r.key]])),
        f,
        score: sc,
      });
      return f;
    },
    {
      dim: ranges.length,
      initial: [startU, ...lhs],
      iterations,
      seed: args.seed ?? 1,
      onEval: (e) => args.onEval?.({ index: e.index, total: initialN + iterations, best: e.best }),
    },
  );
  const bestPid = pidOf(bo.x);
  const baseline = { pid: start, tuning: base, heldOut: evaluate(start, held) };
  const best = { pid: bestPid, tuning: evaluate(bestPid, seeds), heldOut: evaluate(bestPid, held) };
  const faster = (a: TuneScore, b: TuneScore) =>
    a.meanLapTimeMs !== undefined &&
    (b.meanLapTimeMs === undefined || a.meanLapTimeMs < b.meanLapTimeMs);
  const improved =
    faster(best.heldOut, baseline.heldOut) &&
    best.heldOut.robustness >= baseline.heldOut.robustness &&
    best.tuning.robustness >= baseline.tuning.robustness;
  return { baseline, best, improved, history };
}
