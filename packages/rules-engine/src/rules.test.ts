import { describe, expect, it } from "vitest";
import { RULES } from "./index.js";
import {
  GOOD_PARTS,
  apply,
  connect,
  disconnect,
  findings,
  freeMcuPin,
  ids,
  lookupWith,
  move,
  robot,
  type Robot,
} from "./__tests__/kit.js";

const good = robot();
const without = (ps: string[], ...drop: string[]) => {
  const out = [...ps];
  for (const d of drop) out.splice(out.indexOf(d), 1);
  return out;
};
const swap = (from: string, to: string) => GOOD_PARTS.map((p) => (p === from ? to : p));
const ESP = ["mcu.esp32-devkitc", ...GOOD_PARTS.filter((p) => p !== "mcu.arduino-nano")];
const plus = (...extra: string[]) => [...GOOD_PARTS, ...extra];
const heavyBattery = (massG: number) =>
  lookupWith({ "battery.lipo-2s-300mah": (c) => ({ ...c, massG }) });

/** For every rule: a design built to trigger it. */
const TRIGGERS: Record<string, () => Robot> = {
  "elec.short-circuit": () => apply(good, connect("battery1.BAT+", "mcu1.GND")),
  "elec.supply-conflict": () => apply(good, connect("battery1.BAT+", "mcu1.5V")),
  "elec.reverse-polarity": () =>
    apply(good, disconnect("battery1.BAT-"), connect("battery1.BAT-", "mcu1.VIN")),
  "elec.missing-common-ground": () => apply(good, disconnect("motor-driver1.GND")),
  "elec.unpowered": () => apply(good, disconnect("line-sensor1.VCC")),
  "elec.supply-overvoltage": () =>
    apply(good, disconnect("line-sensor1.VCC"), connect("line-sensor1.VCC", "battery1.BAT+")),
  "elec.supply-undervoltage": () =>
    robot({ parts: swap("battery.lipo-2s-300mah", "battery.lipo-1s-500mah") }),
  "elec.io-overvoltage": () => {
    const r = robot({ parts: plus("comm.hc-05") });
    return apply(
      r,
      connect(
        "communication1.RXD",
        freeMcuPin(r, (f) => f.includes("digital")),
      ),
    );
  },
  "elec.regulator-dropout": () =>
    robot({ parts: swap("regulator.pololu-d24v10f5", "regulator.ams1117-5v0-module") }),
  "elec.regulator-overload": () =>
    robot({
      lookup: lookupWith({
        "regulator.pololu-d24v10f5": (c) => ({
          ...c,
          electrical: { ...c.electrical, maxOutputCurrentA: 0.05 } as typeof c.electrical,
        }),
      }),
    }),
  "elec.linear-regulator-heat": () =>
    robot({
      parts: swap("regulator.pololu-d24v10f5", "regulator.ams1117-5v0-module").map((p) =>
        p === "battery.lipo-2s-300mah" ? "battery.lipo-3s-450mah" : p,
      ),
    }),
  "elec.adjustable-regulator": () => {
    const r = robot({ parts: swap("regulator.pololu-d24v10f5", "regulator.lm2596-module") });
    return apply(r, connect("regulator1.OUT+", "mcu1.5V"));
  },
  "elec.motor-direct-mcu": () =>
    apply(
      good,
      connect(
        "motor1.M+",
        freeMcuPin(good, (f) => f.includes("digital")),
      ),
    ),
  "elec.motor-unconnected": () => apply(good, disconnect("motor1.M+"), disconnect("motor1.M-")),
  "elec.motor-stall-current": () =>
    robot({
      lookup: lookupWith({
        "driver.tb6612fng": (c) => ({
          ...c,
          electrical: {
            ...c.electrical,
            peakCurrentPerChannelA: 1,
            continuousCurrentPerChannelA: 0.5,
          } as typeof c.electrical,
        }),
      }),
    }),
  "elec.motor-overvoltage": () =>
    robot({ parts: swap("battery.lipo-2s-300mah", "battery.lipo-3s-450mah") }),
  "elec.driver-drop": () =>
    robot({
      parts: swap("driver.tb6612fng", "driver.l298n-module").map((p) =>
        p === "motor.pololu-hp-6v-30-1" ? "motor.pololu-hpcb-12v-30-1" : p,
      ),
    }),
  "elec.battery-current": () =>
    robot({
      lookup: lookupWith({
        "battery.lipo-2s-300mah": (c) => ({
          ...c,
          electrical: { ...c.electrical, maxContinuousDischargeA: 2 } as typeof c.electrical,
        }),
      }),
    }),
  "elec.nine-volt-battery": () =>
    robot({ parts: swap("battery.lipo-2s-300mah", "battery.9v-alkaline") }),
  "elec.standby-unconnected": () => apply(good, disconnect("motor-driver1.STBY")),
  "elec.driver-input-floating": () => apply(good, disconnect("motor-driver1.AIN1")),
  "elec.pwm-pin-required": () =>
    apply(
      good,
      disconnect("motor-driver1.PWMA"),
      connect(
        "motor-driver1.PWMA",
        freeMcuPin(
          good,
          (f) => f.includes("digital") && !f.includes("pwm") && !f.includes("analog"),
        ),
      ),
    ),
  "elec.adc-pin-required": () =>
    apply(
      good,
      disconnect("line-sensor1.OUT1"),
      connect(
        "line-sensor1.OUT1",
        freeMcuPin(good, (f) => f.includes("digital") && !f.includes("analog")),
      ),
    ),
  "elec.esp32-adc2-wifi": () => robot({ parts: ESP }),
  "elec.input-only-pin": () => {
    const r = robot({ parts: ESP });
    return apply(r, disconnect("motor-driver1.AIN1"), connect("motor-driver1.AIN1", "mcu1.GPIO34"));
  },
  "elec.strapping-pin": () => {
    const r = robot({ parts: ESP });
    return apply(r, disconnect("motor-driver1.AIN1"), connect("motor-driver1.AIN1", "mcu1.GPIO12"));
  },
  "elec.serial-pin": () =>
    apply(good, disconnect("motor-driver1.AIN1"), connect("motor-driver1.AIN1", "mcu1.D1")),
  "elec.i2c-address-conflict": () =>
    robot({ parts: plus("sensor.vl53l0x-breakout", "sensor.tcs34725-breakout") }),
  "elec.i2c-pins": () => {
    const r = robot({ parts: plus("sensor.mpu6050-gy521"), applyFixes: true });
    return apply(
      r,
      disconnect("sensor1.SDA"),
      connect(
        "sensor1.SDA",
        freeMcuPin(r, (f) => f.includes("digital") && !f.includes("i2c_sda")),
      ),
    );
  },
  "elec.uart-crossed": () => {
    const r = robot({ parts: plus("comm.hc-05") });
    return apply(r, connect("communication1.TXD", "mcu1.D1"));
  },
  "elec.switch-current": () => {
    const r = robot({ parts: plus("input.slide-ss12d00") });
    return apply(r, connect("input1.COM", "battery1.BAT+"));
  },
  "elec.led-resistor": () => {
    const r = robot({ parts: plus("indicator.led-5mm-red") });
    return apply(
      r,
      connect(
        "indicator1.A",
        freeMcuPin(r, (f) => f.includes("digital")),
      ),
      connect("indicator1.K", "mcu1.GND"),
    );
  },
  "elec.sensor-unconnected": () => apply(good, disconnect("line-sensor1.OUT8")),
  "elec.no-mcu": () => robot({ parts: without(GOOD_PARTS, "mcu.arduino-nano") }),
  "elec.no-battery": () => robot({ parts: without(GOOD_PARTS, "battery.lipo-2s-300mah") }),

  "mech.collision": () => {
    const mcu = good.design.placements.find((p) => p.instanceId === "mcu1");
    return apply(good, move("motor-driver1", mcu?.position.x ?? 0, mcu?.position.y ?? 0, good));
  },
  "mech.wheels-missing": () => apply(good, { type: "remove", ids: ["wheel2"] }),
  "mech.motors-missing": () => apply(good, { type: "remove", ids: ["motor2"] }),
  "mech.no-third-support": () => apply(good, { type: "remove", ids: ["caster1"] }),
  "mech.cog-outside-support": () => {
    const r = robot({ lookup: heavyBattery(1000) });
    return apply(r, move("battery1", -20, 0, r));
  },
  "mech.cog-near-edge": () => {
    const r = robot({ lookup: heavyBattery(2000) });
    return apply(r, move("battery1", 5, 0, r));
  },
  "mech.sensor-height": () => robot({ applyFixes: false }),
  "mech.sensor-touching": () => {
    const s = good.design.placements.find((p) => p.instanceId === "line-sensor1");
    if (!s) throw new Error("sensor");
    return apply(good, {
      type: "update",
      changes: [
        { id: s.instanceId, patch: { standoffMm: 30, position: { ...s.position, z: -12 } } },
      ],
    });
  },
  "mech.lookahead-short": () => apply(good, move("line-sensor1", 15, 0, good)),
  "mech.lookahead-long": () => apply(good, move("line-sensor1", 260, 0, good)),
  "mech.single-sensor": () =>
    robot({ parts: swap("sensor.pololu-qtr-8a", "sensor.tcrt5000-module") }),
  "mech.sensor-span-narrow": () =>
    robot({ parts: swap("sensor.pololu-qtr-8a", "sensor.tcrt5000-3ch") }),
  "mech.caster-gap": () => robot({ applyFixes: false }),
  "mech.overhang": () => apply(good, move("mcu1", -10, 60, good)),
  "mech.weak-motors": () => robot({ lookup: heavyBattery(3000) }),
};

describe("rules engine", () => {
  it("has at least 30 electrical and 10 mechanical rules, all with unique ids", () => {
    expect(RULES.filter((r) => r.category === "electrical").length).toBeGreaterThanOrEqual(30);
    expect(RULES.filter((r) => r.category === "mechanical").length).toBeGreaterThanOrEqual(10);
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
  });

  it("every rule has a trigger case", () => {
    expect(Object.keys(TRIGGERS).sort()).toEqual(RULES.map((r) => r.id).sort());
  });

  it("the reference robot is clean", () => {
    expect(findings(good).map((f) => `${f.severity} ${f.id}: ${f.message}`)).toEqual([]);
  });

  for (const rule of RULES) {
    describe(rule.id, () => {
      it("does not fire on the clean reference robot", () => {
        expect(ids(good).has(rule.id)).toBe(false);
      });
      it("fires on a design built to break it", () => {
        const make = TRIGGERS[rule.id];
        if (!make) throw new Error(`no trigger for ${rule.id}`);
        const found = findings(make()).filter((f) => f.id === rule.id);
        expect(found.length, [...ids(make())].join(", ")).toBeGreaterThan(0);
        for (const f of found) {
          expect(f.severity).toBe(rule.severity);
          expect(f.message.length).toBeGreaterThan(10);
          expect(f.explanation.length).toBeGreaterThan(20);
        }
      });
    });
  }
});

describe("one-click fixes", () => {
  for (const id of [
    "elec.missing-common-ground",
    "elec.standby-unconnected",
    "mech.sensor-height",
    "mech.caster-gap",
    "mech.sensor-touching",
  ]) {
    it(`${id}: applying its fix clears it`, () => {
      const make = TRIGGERS[id];
      if (!make) throw new Error(id);
      const r = make();
      const f = findings(r).find((x) => x.id === id);
      expect(f?.fix).toBeDefined();
      const after = apply(r, ...(f?.fix?.operations ?? []));
      expect(ids(after).has(id)).toBe(false);
    });
  }
});

describe("performance", () => {
  it("checks a typical robot in well under 50 ms", () => {
    findings(good); // warm up
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) findings(good);
    expect((performance.now() - t0) / 10).toBeLessThan(50);
  });
});
