import type { Frame, RunMetrics, RunTrace, Track } from "@linelab/schema";
import type { RobotModel } from "../model/robot.js";
import { TrackField } from "../track/geometry.js";
import type { Controller } from "./controller.js";
import {
  DEFAULT_CONFIG,
  SIM_FIELD,
  Simulation,
  TRACE_CHANNELS,
  type SimConfig,
  type SimResult,
} from "./simulation.js";
import { NOMINAL, randomVariation } from "./variation.js";

/** Convert a packed trace into the schema's RunTrace (JSON; for storage, export and the agent). */
export function toRunTrace(
  result: SimResult,
  meta: { runId: string; seed: number; designHash: string; trackId: string; firmwareHash?: string },
  dtMs = DEFAULT_CONFIG.dtMs,
): RunTrace {
  const { data, stride, count, sensorCount } = result.trace;
  const n0 = TRACE_CHANNELS.length;
  const frames: Frame[] = [];
  for (let i = 0; i < count; i++) {
    const o = i * stride;
    const g = (k: number) => data[o + k] ?? 0;
    frames.push({
      tMs: g(0),
      pose: { x: g(1), y: g(2), headingRad: g(3) },
      velocity: { v: g(4), omega: g(5) },
      sensors: Array.from({ length: sensorCount }, (_, j) => g(n0 + j)),
      pwm: { left: g(6), right: g(7) },
      batteryV: Math.max(0, g(8)),
    });
  }
  return { ...meta, dtMs, frames, events: result.events, metrics: result.metrics };
}

export interface MonteCarloRun {
  seed: number;
  outcome: SimResult["outcome"];
  metrics: RunMetrics;
  hash: string;
}

export interface MonteCarloResult {
  runs: MonteCarloRun[];
  /** Fraction of seeds that finished. */
  robustness: number;
  /** Means over finished runs (undefined if none finished). */
  meanLapTimeMs: number | undefined;
  meanLateralErrorMm: number | undefined;
}

/**
 * Run the same robot and controller over many seeds, each with its own randomised friction,
 * noise, light, battery charge, motor mismatch and start pose (BLUEPRINT §5.6). Seed 0 is the
 * nominal robot.
 */
export function runMonteCarlo(
  robot: RobotModel,
  track: Track | TrackField,
  makeController: () => Controller,
  seeds: readonly number[],
  config: Partial<SimConfig> = {},
): MonteCarloResult {
  const field = track instanceof TrackField ? track : new TrackField(track, SIM_FIELD);
  const runs = seeds.map((seed) => {
    const sim = new Simulation(robot, field, makeController(), {
      ...config,
      seed,
      variation: seed === 0 ? NOMINAL : randomVariation(seed),
      recordEveryMs: config.recordEveryMs ?? 50,
    });
    const r = sim.run();
    return { seed, outcome: r.outcome, metrics: r.metrics, hash: r.hash };
  });
  const ok = runs.filter((r) => r.outcome === "finished");
  const mean = (xs: number[]) =>
    xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
  return {
    runs,
    robustness: runs.length > 0 ? ok.length / runs.length : 0,
    meanLapTimeMs: mean(
      ok.flatMap((r) => (r.metrics.lapTimeMs !== undefined ? [r.metrics.lapTimeMs] : [])),
    ),
    meanLateralErrorMm: mean(ok.map((r) => r.metrics.meanLateralErrorMm)),
  };
}
