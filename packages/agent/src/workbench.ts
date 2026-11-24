import type { Lookup } from "@linelab/design-core";
import { runFirmware } from "@linelab/firmware-runtime";
import { lintSketch } from "@linelab/firmware-lint";
import { buildRunReport, pinContextFor, type RunReport } from "@linelab/run-report";
import type {
  Board,
  Chassis,
  CompileDiagnostic,
  Design,
  FirmwareArtifact,
  FirmwareFinding,
  Track,
} from "@linelab/schema";
import {
  buildRobotModel,
  column,
  NOMINAL,
  randomVariation,
  SIM_FIELD,
  TRACE_CHANNELS,
  TrackField,
  type PackedTrace,
  type RobotModel,
  type TraceChannel,
} from "@linelab/sim-core";
import { resolveWiring, type FirmwareWiring } from "@linelab/firmware-runtime";
import type { Compiler } from "./compiler.js";

export interface WorkbenchOptions {
  design: Design;
  chassis: Chassis;
  lookup: Lookup;
  track: Track;
  board: Board;
  /** File name the sketch is compiled under (line numbers refer to it). */
  file: string;
  /** Seeds of the user's run. */
  seeds: number[];
  /** Extra seeds the gate adds, so a fix must also hold on conditions it wasn't tuned on. */
  freshSeeds?: number[];
}

export interface SeedResult {
  seed: number;
  outcome: string;
  completionPct: number;
  lapTimeMs: number | undefined;
  meanLateralErrorMm: number;
  /** Types of error-level events. */
  errors: string[];
  warnings: string[];
}

export type Evaluation =
  | { ok: false; diagnostics: CompileDiagnostic[]; log: string }
  | {
      ok: true;
      source: string;
      artifact: FirmwareArtifact;
      seeds: SeedResult[];
      /** Fraction of seeds that finished. */
      robustness: number;
      meanCompletionPct: number;
      lint: FirmwareFinding[];
      /** Full report and trace of the first seed (the user's run). */
      report: RunReport;
      trace: PackedTrace;
      serial: string;
    };
export type OkEvaluation = Extract<Evaluation, { ok: true }>;

const RECORD_MS = 10;

/**
 * The deterministic environment the agent works in: the user's robot, track and seeds. Every tool
 * the model calls and every gate check runs here, on the real compiler output and the simulator.
 */
export class Workbench {
  readonly robot: RobotModel;
  readonly wiring: FirmwareWiring;
  readonly field: TrackField;
  readonly allSeeds: number[];
  private readonly cache = new Map<string, Promise<Evaluation>>();

  constructor(
    readonly opts: WorkbenchOptions,
    readonly compiler: Compiler,
  ) {
    this.robot = buildRobotModel(opts.design, opts.chassis, opts.lookup);
    this.wiring = resolveWiring(opts.design, opts.lookup, this.robot);
    this.field = new TrackField(opts.track, SIM_FIELD);
    this.allSeeds = [...new Set([...opts.seeds, ...(opts.freshSeeds ?? [1001, 1002])])];
  }

  lint(source: string): FirmwareFinding[] {
    return lintSketch(source, { file: this.opts.file, pins: pinContextFor(this.wiring) });
  }

  /** Compile and run on every seed (cached per source). */
  evaluate(source: string): Promise<Evaluation> {
    const hit = this.cache.get(source);
    if (hit) return hit;
    const p = this.evaluateUncached(source);
    this.cache.set(source, p);
    return p;
  }

  private async evaluateUncached(source: string): Promise<Evaluation> {
    const compiled = await this.compiler.compile({
      board: this.opts.board,
      files: { [this.opts.file]: source },
    });
    if (!compiled.ok) return { ok: false, diagnostics: compiled.diagnostics, log: compiled.log };
    const artifact = compiled.artifact;
    const seeds: SeedResult[] = [];
    let first: { report: RunReport; trace: PackedTrace; serial: string } | undefined;
    for (const seed of this.allSeeds) {
      const run = runFirmware({
        design: this.opts.design,
        lookup: this.opts.lookup,
        robot: this.robot,
        track: this.opts.track,
        artifact,
        config: {
          seed,
          recordEveryMs: RECORD_MS,
          variation: seed === 0 ? NOMINAL : randomVariation(seed),
        },
      });
      const report = buildRunReport({
        result: run.result,
        field: this.field,
        recordEveryMs: RECORD_MS,
        firmware: { run, source, file: this.opts.file },
      });
      seeds.push({
        seed,
        outcome: report.outcome,
        completionPct: report.metrics.completionPct,
        lapTimeMs: report.metrics.lapTimeMs,
        meanLateralErrorMm: report.metrics.meanLateralErrorMm,
        errors: [
          ...new Set(report.events.filter((e) => e.severity === "error").map((e) => e.type)),
        ],
        warnings: [
          ...new Set(report.events.filter((e) => e.severity === "warning").map((e) => e.type)),
        ],
      });
      first ??= { report, trace: run.result.trace, serial: run.serial };
    }
    if (!first) throw new Error("no seeds");
    const finished = seeds.filter((s) => s.outcome === "finished").length;
    return {
      ok: true,
      source,
      artifact,
      seeds,
      robustness: finished / seeds.length,
      meanCompletionPct: seeds.reduce((a, s) => a + s.completionPct, 0) / seeds.length,
      lint: this.lint(source),
      ...first,
    };
  }

  /** Numbers from the user's run (first seed) between two times, downsampled to ≤ 60 rows. */
  traceWindow(ev: OkEvaluation, tStartMs: number, tEndMs: number, signals: string[]): string {
    const names = signals.filter((s): s is TraceChannel =>
      (TRACE_CHANNELS as readonly string[]).includes(s),
    );
    const sensors = signals.includes("sensors");
    const t = column(ev.trace, "tMs");
    const idx: number[] = [];
    for (let i = 0; i < ev.trace.count; i++)
      if ((t[i] ?? 0) >= tStartMs && (t[i] ?? 0) <= tEndMs) idx.push(i);
    const step = Math.max(1, Math.ceil(idx.length / 60));
    const cols = names.map((n) => column(ev.trace, n));
    const sensorCols = sensors
      ? Array.from({ length: ev.trace.sensorCount }, (_, k) => column(ev.trace, k))
      : [];
    const header = ["tMs", ...names, ...sensorCols.map((_, k) => `s${String(k + 1)}`)].join(",");
    const rows = idx
      .filter((_, k) => k % step === 0)
      .map((i) =>
        [t[i] ?? 0, ...cols.map((c) => c[i] ?? 0), ...sensorCols.map((c) => c[i] ?? 0)]
          .map((v) => (Number.isInteger(v) ? String(v) : v.toFixed(2)))
          .join(","),
      );
    return [header, ...rows].join("\n");
  }
}
