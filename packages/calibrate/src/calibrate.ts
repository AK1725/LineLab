import type { Design, TelemetryRecording, TwinParams } from "@linelab/schema";
import {
  SIM_FIELD,
  TrackField,
  type Controller,
  type RobotModel,
  type SimConfig,
} from "@linelab/sim-core";
import type { Track } from "@linelab/schema";
import { cmaes } from "./cmaes.js";
import { compareToRecording, type TraceComparison } from "./replay.js";
import { TWIN_PARAMS, specOf, toUnit, twinFromUnit, type TwinKey } from "./twin.js";

export interface CalibrationInput {
  design: Design;
  /** Builds the robot model for a design carrying the given twin parameters. */
  buildRobot: (design: Design) => RobotModel;
  track: Track;
  recording: TelemetryRecording;
  /** The controller the real robot ran: its firmware on the emulated MCU, or the reference PID. */
  makeController: () => Controller;
  /** Parameters to fit (default: all of TWIN_PARAMS). */
  keys?: readonly TwinKey[];
  /** Fit window, ms after motion starts (default 0–3000). */
  fitWindowMs?: [number, number];
  /** Held-out window to report (default: the rest of the recording, if ≥ 1 s of it). */
  holdoutWindowMs?: [number, number];
  maxEvals?: number;
  seed?: number;
  config?: Partial<SimConfig>;
  onProgress?: (p: { evals: number; maxEvals: number; bestError: number }) => void;
}

export interface CalibrationResult {
  twin: TwinParams;
  before: TraceComparison;
  after: TraceComparison;
  /** 1 − after/before on the fit window. */
  reduction: number;
  holdout?: { before: TraceComparison; after: TraceComparison; reduction: number };
  evals: number;
  history: { evals: number; bestError: number }[];
}

const withTwin = (design: Design, twin: TwinParams): Design => ({ ...design, calibration: twin });

/**
 * Fit the digital twin to a recording (BLUEPRINT §5.9.1): CMA-ES over the twin parameters,
 * minimising the error between the simulated and the recorded sensor and PWM traces when the
 * simulated robot runs the same controller from the same start.
 */
export function calibrateTwin(input: CalibrationInput): CalibrationResult {
  const keys = input.keys ?? TWIN_PARAMS.map((p) => p.key);
  const field = new TrackField(
    input.recording.startPose ? { ...input.track, start: input.recording.startPose } : input.track,
    SIM_FIELD,
  );
  const span = (() => {
    const s = input.recording.samples;
    return (s.at(-1)?.tMs ?? 0) - (s[0]?.tMs ?? 0);
  })();
  const fit = input.fitWindowMs ?? [0, Math.min(3000, span)];
  const holdout =
    input.holdoutWindowMs ??
    (span - fit[1] >= 1000 ? ([fit[1], span] as [number, number]) : undefined);
  const nominalRobot = input.buildRobot(withTwin(input.design, {}));
  const ctx = (w: [number, number]) => ({
    recording: input.recording,
    field,
    makeController: input.makeController,
    fromMs: w[0],
    toMs: w[1],
    seed: input.seed ?? 1,
    ...(input.config ? { config: input.config } : {}),
  });
  const compare = (twin: TwinParams, w: [number, number]) =>
    compareToRecording(input.buildRobot(withTwin(input.design, twin)), ctx(w));

  const nominalTwin: TwinParams = {};
  for (const k of keys) nominalTwin[k] = specOf(k).nominal(nominalRobot);
  const before = compare({}, fit);
  const maxEvals = input.maxEvals ?? 160;
  const history: CalibrationResult["history"] = [];
  const r = cmaes(
    (u) => {
      const e = compare(twinFromUnit(keys, u), fit).error;
      return Number.isFinite(e) ? e : 10;
    },
    {
      x0: keys.map((k) => toUnit(specOf(k), nominalTwin[k] ?? 0)),
      sigma0: 0.2,
      maxEvals,
      seed: input.seed ?? 1,
      onGeneration: (g) => {
        history.push({ evals: g.evals, bestError: g.bestF });
        input.onProgress?.({ evals: g.evals, maxEvals, bestError: g.bestF });
      },
    },
  );
  const twin = twinFromUnit(keys, r.x);
  const after = compare(twin, fit);
  const result: CalibrationResult = {
    twin,
    before,
    after,
    reduction: 1 - after.error / before.error,
    evals: r.evals,
    history,
  };
  if (holdout) {
    const hb = compare({}, holdout);
    const ha = compare(twin, holdout);
    result.holdout = { before: hb, after: ha, reduction: 1 - ha.error / hb.error };
  }
  return result;
}
