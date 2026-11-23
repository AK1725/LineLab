import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Battery, openCircuitVoltage } from "../model/battery.js";
import { motorParams, motorStep } from "../model/motor.js";
import { heightGain, readChannel, type SensorChannel } from "../model/sensor.js";
import { Prng } from "../prng.js";
import { TrackBuilder } from "../track/builder.js";
import { ConstantController } from "./controller.js";
import { column, Simulation } from "./simulation.js";
import { referenceRobot, specOf } from "./test-kit.js";

const hp30 = specOf("motor.pololu-hp-6v-30-1", "motor");
const lipo2s = specOf("battery.lipo-2s-300mah", "battery");

describe("prng", () => {
  it("is deterministic per seed and differs between seeds", () => {
    const a = new Prng(42);
    const b = new Prng(42);
    const c = new Prng(43);
    const xs = Array.from({ length: 5 }, () => a.nextU32());
    expect(Array.from({ length: 5 }, () => b.nextU32())).toEqual(xs);
    expect(Array.from({ length: 5 }, () => c.nextU32())).not.toEqual(xs);
  });
  it("gives uniform [0,1) and standard normal samples", () => {
    const r = new Prng(7);
    const u = Array.from({ length: 20000 }, () => r.next());
    expect(Math.min(...u)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...u)).toBeLessThan(1);
    expect(u.reduce((s, x) => s + x, 0) / u.length).toBeCloseTo(0.5, 1);
    const g = Array.from({ length: 20000 }, () => r.gaussian());
    const mean = g.reduce((s, x) => s + x, 0) / g.length;
    const variance = g.reduce((s, x) => s + (x - mean) ** 2, 0) / g.length;
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(variance).toBeGreaterThan(0.95);
    expect(variance).toBeLessThan(1.05);
  });
});

describe("motor model", () => {
  const m = motorParams(hp30);
  it("reproduces the datasheet no-load speed and stall torque at rated voltage", () => {
    // No load: torque balance at ω0 is zero (friction = Kt·I0).
    const atNoLoad = motorStep(m, hp30.ratedVoltageV, m.noLoadSpeedRadS, 100);
    expect(Math.abs(atNoLoad.torqueNm)).toBeLessThan(1e-3);
    expect(atNoLoad.currentA).toBeCloseTo(hp30.noLoadCurrentA, 2);
    const stall = motorStep(m, hp30.ratedVoltageV, 0, 100);
    expect(stall.currentA).toBeCloseTo(hp30.stallCurrentA, 6);
    // Just above standstill, once friction acts, the output torque is the datasheet stall torque.
    const nearStall = motorStep(m, hp30.ratedVoltageV, 3, 100);
    expect(nearStall.torqueNm).toBeCloseTo(m.stallTorqueNm * (1 - 3 / m.noLoadSpeedRadS), 3);
  });
  it("limits current and torque falls linearly with speed (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0.1, max: 1, noNaN: true }),
        (f, limit) => {
          const w = f * m.noLoadSpeedRadS;
          const s = motorStep(m, hp30.ratedVoltageV, w, limit);
          expect(Math.abs(s.currentA)).toBeLessThanOrEqual(limit + 1e-12);
          const free = motorStep(m, hp30.ratedVoltageV, w, 100);
          const expected = m.stallTorqueNm * (1 - w / m.noLoadSpeedRadS);
          expect(free.torqueNm).toBeCloseTo(expected, 2);
        },
      ),
    );
  });
});

describe("battery model", () => {
  it("open-circuit voltage runs from cutoff (empty) to full and never decreases with charge", () => {
    expect(openCircuitVoltage(lipo2s, 0)).toBeCloseTo(lipo2s.cutoffVoltageV);
    expect(openCircuitVoltage(lipo2s, 1)).toBeCloseTo(lipo2s.fullVoltageV);
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (a, b) => {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          expect(openCircuitVoltage(lipo2s, hi)).toBeGreaterThanOrEqual(
            openCircuitVoltage(lipo2s, lo),
          );
        },
      ),
    );
  });
  it("sags under load by I·R and loses charge", () => {
    const b = new Battery(lipo2s, 0.8);
    const v0 = b.terminalVoltage(0);
    expect(v0 - b.terminalVoltage(2)).toBeCloseTo(
      2 * (lipo2s.internalResistanceMilliohm / 1000),
      6,
    );
    b.draw(1, 36); // 10 mAh
    expect(b.soc).toBeCloseTo(0.8 - 10 / 300, 6);
  });
});

describe("IR sensor model", () => {
  const ch = (h: number, output: SensorChannel["output"] = "analog"): SensorChannel => ({
    xMm: 0,
    yMm: 0,
    heightMm: h,
    optimalMaxMm: 6,
    output,
    instanceId: "s",
    channel: 1,
  });
  const env = { ambient: 0, noiseStd: 0, gain: 1, offset: 0 };
  it("reads dark lines high and white background low; contrast fades above the optimal height", () => {
    const r = new Prng(1);
    const dark = readChannel(ch(3), 0.05, env, 1023, r);
    const white = readChannel(ch(3), 0.85, env, 1023, r);
    expect(dark).toBeGreaterThan(900);
    expect(white).toBeLessThan(200);
    const high = ch(18);
    expect(
      readChannel(high, 0.05, env, 1023, r) - readChannel(high, 0.85, env, 1023, r),
    ).toBeLessThan((dark - white) * 0.3);
    expect(heightGain(4, 6)).toBe(1);
  });
  it("models comparator and RC boards", () => {
    const r = new Prng(1);
    expect(readChannel(ch(3, "digital"), 0.05, env, 1, r)).toBe(1);
    expect(readChannel(ch(3, "digital"), 0.85, env, 1, r)).toBe(0);
    expect(readChannel(ch(3, "rc"), 0.05, env, 2500, r)).toBeGreaterThan(2000);
    expect(readChannel(ch(3, "rc"), 0.85, env, 2500, r)).toBeLessThan(600);
  });
  it("adds ambient light (lower readings) and quantises to whole counts", () => {
    const r = new Prng(1);
    const a = readChannel(ch(3), 0.5, env, 1023, r);
    const b = readChannel(ch(3), 0.5, { ...env, ambient: 0.1 }, 1023, r);
    expect(b).toBeLessThan(a);
    expect(Number.isInteger(a)).toBe(true);
  });
});

describe("drive dynamics (properties)", () => {
  // The reference robot with its CoG moved onto the centreline, so it is left/right symmetric.
  const ref = referenceRobot();
  const half = (ref.wheelLoadN[0] + ref.wheelLoadN[1]) / 2;
  const robot = {
    ...ref,
    cogM: { ...ref.cogM, y: 0 },
    wheelLoadN: [half, half] as [number, number],
  };
  const straight = new TrackBuilder({ x: 0, y: 0, headingRad: 0 })
    .forward(6000)
    .build({ id: "track.test-straight", name: "Straight" }, { x: 0, y: 0, headingRad: 0 });
  const drive = (left: number, right: number, ms = 1500) => {
    const sim = new Simulation(robot, straight, new ConstantController({ left, right }), {
      durationMs: ms,
      offTrackMm: 1e6,
      stuckForMs: 1e9,
      variation: {
        frictionScale: 1,
        sensorNoiseStd: 0,
        ambient: 0,
        soc: 0.9,
        ktScaleLeft: 1,
        ktScaleRight: 1,
        startDxMm: 0,
        startDyMm: 0,
        startDHeadingRad: 0,
      },
    });
    const r = sim.run();
    const last = (c: Parameters<typeof column>[1]) => column(r.trace, c).at(-1) ?? NaN;
    return {
      x: last("xMm"),
      y: last("yMm"),
      heading: last("headingRad"),
      v: last("vMmS"),
      omega: last("omegaRadS"),
      r,
    };
  };

  it("equal duties drive straight, and more duty means more speed", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.2, max: 0.9, noNaN: true }), (d) => {
        const a = drive(d, d);
        expect(Math.abs(a.heading)).toBeLessThan(1e-6);
        expect(Math.abs(a.y)).toBeLessThan(1e-3);
        const b = drive(Math.min(1, d + 0.1), Math.min(1, d + 0.1));
        expect(b.v).toBeGreaterThan(a.v);
      }),
      { numRuns: 8 },
    );
  });

  it("turns towards the slower wheel, and mirrored duties mirror the path", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.2, max: 0.8, noNaN: true }),
        fc.double({ min: 0.05, max: 0.3, noNaN: true }),
        (d, diff) => {
          const right = drive(d + diff, d, 800); // left faster: turns right (clockwise)
          const left = drive(d, d + diff, 800);
          expect(right.omega).toBeLessThan(0);
          expect(left.omega).toBeGreaterThan(0);
          expect(left.y).toBeCloseTo(-right.y, 6);
          expect(left.x).toBeCloseTo(right.x, 6);
        },
      ),
      { numRuns: 8 },
    );
  });

  it("stays still with zero duty, and reverse duty drives backwards", () => {
    const still = drive(0, 0, 500);
    expect(Math.hypot(still.x, still.y)).toBeLessThan(1e-9);
    const back = drive(-0.5, -0.5, 800);
    expect(back.x).toBeLessThan(-50);
  });

  it("never gains more kinetic energy than the battery delivered", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.1, max: 1, noNaN: true }),
        fc.double({ min: 0.1, max: 1, noNaN: true }),
        (l, r) => {
          const out = drive(l, r, 700);
          const v = out.v / 1000;
          const ke =
            0.5 * robot.massKg * v * v + 0.5 * robot.yawInertiaKgM2 * out.omega * out.omega;
          expect(ke).toBeLessThan(out.r.metrics.energyJ ?? 0);
        },
      ),
      { numRuns: 8 },
    );
  });

  it("an off-centre CoG loads one wheel more, so equal duties drift (the real reference robot)", () => {
    expect(ref.wheelLoadN[1]).toBeGreaterThan(ref.wheelLoadN[0]); // battery on the right
    const sim = new Simulation(ref, straight, new ConstantController({ left: 0.5, right: 0.5 }), {
      durationMs: 1500,
      offTrackMm: 1e6,
    });
    expect(Math.abs(column(sim.run().trace, "headingRad").at(-1) ?? 0)).toBeGreaterThan(1e-4);
  });

  it("reaches a top speed close to the motors' no-load speed at the applied voltage", () => {
    const top = drive(1, 1, 3000);
    const w = robot.wheels[0];
    const vbat = column(top.r.trace, "batteryV").at(-1) ?? 0;
    const noLoad =
      w.motor.noLoadSpeedRadS *
      ((vbat - robot.driver.dropV * 0.6) / hp30.ratedVoltageV) *
      w.radiusM *
      1000;
    expect(top.v).toBeGreaterThan(noLoad * 0.75);
    expect(top.v).toBeLessThan(noLoad * 1.02);
  });
});
