import type { MonteCarloRun, Outcome, PackedTrace, ReferencePidOptions } from "@linelab/sim-core";
import type {
  Design,
  FirmwareArtifact,
  FirmwareFinding,
  RunMetrics,
  SimEvent,
  Track,
} from "@linelab/schema";

export interface RunRequest {
  id: number;
  design: Design;
  track: Track;
  /** The first seed is replayed in full; the others only report metrics (Monte Carlo). */
  seeds: number[];
  pid: Partial<ReferencePidOptions>;
  laps: number;
  /** Run this firmware instead of the reference PID. */
  firmware?: FirmwareArtifact;
  /** The sketch, for source-line attribution and lint in the run report. */
  firmwareSource?: { text: string; file: string };
}

export interface LoopStats {
  count: number;
  meanMs: number;
  p5Ms: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
}

export interface FirmwareReport {
  tier: "emulated" | "hal";
  serial: string;
  resets: number;
  loop: LoopStats | undefined;
  wiringProblems: string[];
  /** Emulated tier: where CPU time goes, by source line and by file. */
  hotLines?: { file: string; line: number; share: number }[];
  hotFiles?: { file: string; share: number }[];
  /** Emulated tier: the sketch's globals sampled with the trace (one array per name). */
  watch?: { names: string[]; types: string[]; samples: number[][] };
  /** Simulated time / wall time. */
  speed: number;
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
  controller: "reference" | "firmware";
  firmware?: FirmwareReport;
  /** LineLab lint findings on the sketch that ran (firmware runs). */
  lint: FirmwareFinding[];
  counts: { errors: number; warnings: number };
}

export type RunResponse =
  | { id: number; kind: "progress"; done: number; total: number }
  /** Heartbeat during a long run (keeps the watchdog quiet). */
  | { id: number; kind: "alive"; simMs: number }
  | {
      id: number;
      kind: "result";
      main: RunSummary;
      trace: PackedTrace;
      runs: MonteCarloRun[];
      robustness: number;
    }
  | { id: number; kind: "error"; message: string; issues?: string[] };
