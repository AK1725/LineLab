import { getComponent } from "@linelab/component-db";
import { RunTrace } from "@linelab/schema";
import { describe, expect, it } from "vitest";
import { SimSetupError } from "../model/robot.js";
import { ReferencePid } from "./controller.js";
import { runMonteCarlo, toRunTrace } from "./run.js";
import { Simulation } from "./simulation.js";
import { builtInTrack, referenceDesign, referenceRobot, robotFor } from "./test-kit.js";
import { NOMINAL, randomVariation } from "./variation.js";

const robot = referenceRobot();
const oval = builtInTrack("oval");
const run = (trackId: string, seed = 1, variation = NOMINAL) =>
  new Simulation(robot, builtInTrack(trackId), new ReferencePid(), { seed, variation }).run();

describe("robot model from a design", () => {
  it("builds the reference robot from component data", () => {
    expect(robot.sensors).toHaveLength(8);
    // Channel 1 is on the robot's left (+y), 9.525 mm pitch, 4.5 mm above the floor.
    expect(robot.sensors[0]?.yMm).toBeCloseTo(3.5 * 9.525);
    expect(robot.sensors[7]?.yMm).toBeCloseTo(-3.5 * 9.525);
    expect(robot.sensors[0]?.heightMm).toBeCloseTo(4.5);
    expect(robot.wheels[0].radiusM).toBeCloseTo(0.016);
    expect(robot.wheels[0].yM - robot.wheels[1].yM).toBeCloseTo(0.091);
    expect(robot.massKg).toBeGreaterThan(0.05);
    expect(robot.massKg).toBeLessThan(0.2);
    expect(
      robot.wheelLoadN[0] + robot.wheelLoadN[1] + robot.casterLoadN.reduce((a, b) => a + b, 0),
    ).toBeCloseTo(robot.massKg * 9.80665);
    expect(robot.notes).toEqual([]);
  });

  it("refuses designs that can't drive, listing what is missing", () => {
    const d = referenceDesign();
    const bare = {
      ...d,
      placements: d.placements.filter(
        (p) => !/motor|battery/.test(p.componentId) || p.componentId.startsWith("driver"),
      ),
    };
    expect(() => robotFor(bare)).toThrow(SimSetupError);
    try {
      robotFor(bare);
    } catch (e) {
      expect((e as SimSetupError).issues).toEqual([
        "Add a drive motor on each side.",
        "Add a battery.",
      ]);
    }
  });

  it("notes approximations (no caster → the chassis edge drags)", () => {
    const d = referenceDesign();
    const noCaster = robotFor({
      ...d,
      placements: d.placements.filter((p) => !p.componentId.startsWith("caster")),
    });
    expect(noCaster.casters[0]?.kind).toBe("edge");
    expect(noCaster.notes.join(" ")).toMatch(/No caster/);
    expect(getComponent("caster.nylon-skid")).toBeDefined();
  });
});

describe("determinism", () => {
  it("same seed → identical trace hash; another seed → a different one", () => {
    const a = run("oval", 1, randomVariation(1));
    const b = run("oval", 1, randomVariation(1));
    expect(b.hash).toBe(a.hash);
    expect(b.trace.data).toEqual(a.trace.data);
    expect(run("oval", 2, randomVariation(2)).hash).not.toBe(a.hash);
  });

  it("matches the golden trace for the reference robot on the oval", () => {
    // If physics changes on purpose, update this hash and say why in the commit message.
    const r = run("oval", 1);
    expect({ hash: r.hash, outcome: r.outcome, lapTimeMs: r.metrics.lapTimeMs }).toEqual({
      hash: GOLDEN_OVAL_HASH,
      outcome: "finished",
      lapTimeMs: GOLDEN_OVAL_LAP_MS,
    });
  });
});

describe("reference controller", () => {
  it.each(["oval", "circle", "long-straight", "wide-gentle"])(
    "completes the easy track %s",
    (id) => {
      const r = run(id);
      expect(r.outcome).toBe("finished");
      expect(r.metrics.completionPct).toBe(100);
      expect(r.metrics.meanLateralErrorMm).toBeLessThan(10);
    },
  );

  it("completes the easy tracks across Monte Carlo variations", () => {
    for (const id of ["oval", "circle", "long-straight", "wide-gentle"]) {
      const mc = runMonteCarlo(
        robot,
        builtInTrack(id),
        () => new ReferencePid(),
        [1, 2, 3, 4, 5, 6, 7, 8],
      );
      expect(mc.robustness, id).toBe(1);
    }
  }, 60_000);

  it("fails expert tracks in plausible ways", () => {
    // Acute angles (135° turns on a 20 mm radius): a fixed-gain PD at cruising speed overshoots a
    // corner, loses the line and never recovers. It must fail at a corner, not on a straight.
    const acute = run("acute-angles");
    expect(["off_track", "stuck"]).toContain(acute.outcome);
    const failedAt = (acute.metrics.completionPct / 100) * 1741;
    expect(Math.min(...[400, 847, 1294].map((c) => Math.abs(failedAt - c)))).toBeLessThan(80);
    // Maze grid: at a junction the weighted position averages two branches; the robot ends
    // up circling or stalled without making progress.
    const maze = run("maze-grid");
    expect(["stuck", "off_track"]).toContain(maze.outcome);
    expect(maze.metrics.completionPct).toBeLessThan(50);
  });

  it("is slower and less accurate with a timid base speed vs the default, and loop rate shows up", () => {
    const slow = new Simulation(robot, oval, new ReferencePid({ baseDuty: 0.3 }), {
      seed: 1,
    }).run();
    const fast = run("oval");
    expect(slow.metrics.lapTimeMs ?? 0).toBeGreaterThan(fast.metrics.lapTimeMs ?? Infinity);
    expect(fast.metrics.loopFrequencyHz).toBe(500);
  });
});

describe("power", () => {
  it("a weak battery browns out the MCU, which resets", () => {
    const weak = {
      ...robot,
      battery: {
        ...robot.battery,
        spec: { ...robot.battery.spec, internalResistanceMilliohm: 2500 },
      },
    };
    const r = new Simulation(weak, oval, new ReferencePid({ baseDuty: 0.9 }), {
      seed: 1,
      durationMs: 3000,
    }).run();
    expect(r.events.some((e) => e.type === "brownout")).toBe(true);
  });
  it("the reference robot does not brown out and uses a plausible amount of energy", () => {
    const r = run("oval");
    expect(r.events.some((e) => e.type === "brownout")).toBe(false);
    // ~1 A for ~5 s at ~7.6 V: tens of joules, not hundreds.
    expect(r.metrics.energyJ).toBeGreaterThan(5);
    expect(r.metrics.energyJ).toBeLessThan(80);
  });
});

describe("run trace export", () => {
  it("produces a schema-valid RunTrace", () => {
    const r = run("oval");
    const t = toRunTrace(r, { runId: "run1", seed: 1, designHash: "d", trackId: oval.id });
    expect(RunTrace.safeParse(t).success).toBe(true);
    expect(t.frames.length).toBe(r.trace.count);
    expect(t.frames[0]?.sensors).toHaveLength(8);
  });
});

// Re-pinned in Phase 7: two trace columns added (lineSeen, distanceMm); physics unchanged (same lap time).
const GOLDEN_OVAL_HASH = "07f2e015a2df24";
const GOLDEN_OVAL_LAP_MS = 4676;

describe("twin parameters", () => {
  const sensorsAt = (calibration: Parameters<typeof robotFor>[0]["calibration"]) => {
    const d = { ...referenceDesign(), ...(calibration ? { calibration } : {}) };
    const sim = new Simulation(robotFor(d), builtInTrack("oval"), new ReferencePid(), {
      durationMs: 400,
      variation: { ...NOMINAL, sensorNoiseStd: 0 },
    });
    const r = sim.run();
    const n = r.trace.sensorCount;
    const row = r.trace.count - 1;
    return Array.from(
      { length: n },
      (_, i) => r.trace.data[row * r.trace.stride + r.trace.stride - n + i] ?? 0,
    );
  };

  it("leaves the nominal robot unchanged when no sensor parameters are fitted", () => {
    expect(robotFor(referenceDesign()).sensorTwin).toBeUndefined();
    expect(sensorsAt({ frictionMu: 0.9 })).toEqual(sensorsAt({ frictionMu: 0.9 }));
  });

  it("applies sensor gain and offset: less contrast and a darker floor", () => {
    const nominal = sensorsAt(undefined);
    const fitted = sensorsAt({ sensorGain: 0.7, sensorOffset: 0.05 });
    const range = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    expect(range(fitted)).toBeLessThan(range(nominal) * 0.85);
    expect(Math.min(...fitted)).toBeGreaterThan(Math.min(...nominal));
  });

  it("adds the twin's latency to the run's", () => {
    const run = (latencyMs?: number) =>
      new Simulation(
        robotFor({
          ...referenceDesign(),
          calibration: latencyMs === undefined ? {} : { latencyMs },
        }),
        builtInTrack("oval"),
        new ReferencePid(),
        { durationMs: 1500 },
      ).run().hash;
    expect(run(8)).not.toBe(run());
    expect(run(0)).toBe(run());
  });
});
