import type { MonteCarloRun, Outcome, PackedTrace, ReferencePidOptions } from "@linelab/sim-core";
import type { Design, RunMetrics, SimEvent, Track } from "@linelab/schema";

export interface RunRequest {
  id: number;
  design: Design;
  track: Track;
  /** The first seed is replayed in full; the others only report metrics (Monte Carlo). */
  seeds: number[];
  pid: Partial<ReferencePidOptions>;
  laps: number;
}

export interface RunSummary {
  seed: number;
  outcome: Outcome;
  metrics: RunMetrics;
  events: SimEvent[];
  notes: string[];
  hash: string;
  durationMs: number;
  recordEveryMs: number;
  /** Sensor channel positions in the chassis frame (mm), for drawing. */
  sensorsMm: { x: number; y: number }[];
}

export type RunResponse =
  | { id: number; kind: "progress"; done: number; total: number }
  | {
      id: number;
      kind: "result";
      main: RunSummary;
      trace: PackedTrace;
      runs: MonteCarloRun[];
      robustness: number;
    }
  | { id: number; kind: "error"; message: string; issues?: string[] };
