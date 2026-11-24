import { ReferencePid, SIM_FIELD, TrackField } from "@linelab/sim-core";
import { describe, expect, it } from "vitest";
import { calibrateTwin } from "./calibrate.js";
import { compareToRecording } from "./replay.js";
import { buildRobot, hiddenTwinFixture, referenceDesign, track } from "./test-kit.js";
import { TWIN_PARAMS, fromUnit, toUnit, twinFromUnit } from "./twin.js";

// Acceptance (BUILD_PLAN Phase 9): calibration cuts sim-vs-real trace error by ≥ 40 %.
// The recording is SYNTHETIC: the simulator with hidden twin parameters (a stand-in until a real
// robot recording is contributed; see docs/PROGRESS.md).
describe("twin calibration on the hidden-twin fixture", () => {
  const { recording, truth } = hiddenTwinFixture();
  const result = calibrateTwin({
    design: referenceDesign(),
    buildRobot,
    track: track("oval"),
    recording,
    makeController: () => new ReferencePid(),
    maxEvals: 160,
  });

  it("is labelled as synthetic", () => {
    expect(recording.source).toBe("synthetic");
    expect(recording.notes.join(" ")).toMatch(/SYNTHETIC/);
  });

  it("reduces the trace error by at least 40 % on the fit window", () => {
    expect(result.reduction).toBeGreaterThanOrEqual(0.4);
    expect(result.after.sensorRms).toBeLessThan(result.before.sensorRms);
  });

  it("also reduces it on the held-out part of the recording", () => {
    expect(result.holdout?.reduction ?? 0).toBeGreaterThanOrEqual(0.4);
  });

  it("recovers the well-identified sensor parameters", () => {
    expect(Math.abs((result.twin.sensorGain ?? 1) - (truth.sensorGain ?? 0))).toBeLessThan(0.1);
    expect(Math.abs((result.twin.sensorOffset ?? 0) - (truth.sensorOffset ?? 0))).toBeLessThan(
      0.04,
    );
  });
});

describe("trace comparison", () => {
  const { recording, truth } = hiddenTwinFixture();
  const field = new TrackField(track("oval"), SIM_FIELD);
  const at = (calibration: Record<string, number>, seed: number) =>
    compareToRecording(buildRobot({ ...referenceDesign(), calibration }), {
      recording,
      field,
      makeController: () => new ReferencePid(),
      fromMs: 0,
      toMs: 3000,
      seed,
    });

  it("is near zero for the generating parameters and noise seed, despite the coarse clock", () => {
    expect(at(truth, 4242).sensorRms).toBeLessThan(0.01);
  });

  it("ranks the true parameters well ahead of the nominal robot", () => {
    expect(at(truth, 1).error).toBeLessThan(at({}, 1).error * 0.6);
  });
});

describe("twin parameter coordinates", () => {
  it("map to and from [0, 1] and clamp", () => {
    for (const s of TWIN_PARAMS) {
      expect(fromUnit(s, toUnit(s, (s.lo + s.hi) / 2))).toBeCloseTo((s.lo + s.hi) / 2, 9);
      expect(fromUnit(s, 2)).toBe(s.hi);
    }
    expect(twinFromUnit(["latencyMs"], [0.2])).toEqual({ latencyMs: 5 });
  });
});
