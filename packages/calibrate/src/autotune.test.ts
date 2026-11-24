import { describe, expect, it } from "vitest";
import { autotunePid } from "./autotune.js";
import { buildRobot, referenceDesign, track } from "./test-kit.js";

// Acceptance (BUILD_PLAN Phase 9): the auto-tuner improves lap time on a fixture design without
// lowering robustness. Checked on held-out Monte Carlo seeds the tuner never saw.
describe("PID auto-tuner", () => {
  const r = autotunePid({
    robot: buildRobot(referenceDesign()),
    track: track("random-curvy"),
    iterations: 20,
  });

  it("finds faster gains", () => {
    expect(r.improved).toBe(true);
    expect(r.best.heldOut.meanLapTimeMs ?? Infinity).toBeLessThan(
      (r.baseline.heldOut.meanLapTimeMs ?? 0) * 0.95,
    );
  });

  it("without lowering robustness on the tuning or held-out seeds", () => {
    expect(r.best.tuning.robustness).toBeGreaterThanOrEqual(r.baseline.tuning.robustness);
    expect(r.best.heldOut.robustness).toBeGreaterThanOrEqual(r.baseline.heldOut.robustness);
  });

  it("starts from the user's gains and records every evaluation", () => {
    expect(r.history[0]?.pid).toMatchObject({ kp: 1.1, kd: 0.035, baseDuty: 0.45 });
    expect(r.history).toHaveLength(10 + 20);
  });
});
