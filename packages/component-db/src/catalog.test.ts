import { Category, Component } from "@linelab/schema";
import { describe, expect, it } from "vitest";
import { CATEGORY_INFO, COMPONENTS, getComponent } from "./index.js";
import { checkCatalog, checkComponent } from "./validate/index.js";

const base = (id: string): Component => {
  const c = getComponent(id);
  if (c === undefined) throw new Error(`missing ${id}`);
  return structuredClone(c);
};

describe("catalog", () => {
  it("has at least 120 components, every one valid against the schema", () => {
    expect(COMPONENTS.length).toBeGreaterThanOrEqual(120);
    for (const c of COMPONENTS) expect(Component.safeParse(c).success, c.id).toBe(true);
  });

  it("passes every catalog-wide check (models fit, pins consistent, aliases unique)", () => {
    expect(checkCatalog(COMPONENTS)).toEqual([]);
  });

  it("covers every category and lists categories once", () => {
    const used = new Set(COMPONENTS.map((c) => c.category));
    for (const cat of Category.options) expect(used.has(cat), cat).toBe(true);
    expect(CATEGORY_INFO.map((c) => c.id).sort()).toEqual([...Category.options].sort());
  });

  it("has the parts a line follower is usually built from", () => {
    for (const id of [
      "mcu.arduino-nano",
      "mcu.arduino-uno-r3",
      "mcu.esp32-devkitc",
      "mcu.raspberry-pi-pico",
      "sensor.pololu-qtr-8a",
      "sensor.tcrt5000-5ch",
      "driver.tb6612fng",
      "driver.l298n-module",
      "motor.n20-6v-1000rpm",
      "motor.pololu-hp-6v-30-1",
      "wheel.pololu-32x7",
      "caster.pololu-ball-3-8-metal",
      "battery.lipo-2s-450mah",
      "regulator.lm2596-module",
    ]) {
      expect(getComponent(id), id).toBeDefined();
    }
  });

  it("marks every entry as needing datasheet review until someone checks it", () => {
    expect(COMPONENTS.every((c) => c.specStatus === "needs-review")).toBe(true);
  });

  it("flags ESP32 ADC2 pins so the WiFi conflict can be detected", () => {
    const esp = base("mcu.esp32-devkitc");
    const adc2 = esp.pins.filter((p) => p.adcUnit === 2).map((p) => p.id);
    expect(adc2).toEqual(expect.arrayContaining(["GPIO4", "GPIO25", "GPIO26", "GPIO27"]));
    expect(
      esp.pins
        .filter((p) => p.inputOnly === true)
        .map((p) => p.id)
        .sort(),
    ).toEqual(["GPIO34", "GPIO35", "GPIO36", "GPIO39"]);
  });
});

describe("checkComponent catches mistakes", () => {
  it("model does not fit its dimensions", () => {
    const c = base("wheel.pololu-32x7");
    c.dimensionsMm = { x: 32, y: 7, z: 10 };
    expect(checkComponent(c).join()).toMatch(/does not fit dimensionsMm|dimensionsMm must be/);
  });

  it("unknown generator", () => {
    const c = base("driver.tb6612fng");
    c.model = { kind: "procedural", generator: "teapot", params: {} };
    expect(checkComponent(c).join()).toMatch(/unknown generator "teapot"/);
  });

  it("duplicate arduinoPin", () => {
    const c = base("mcu.arduino-nano");
    const d2 = c.pins.find((p) => p.id === "D2");
    if (d2) d2.arduinoPin = 3;
    expect(checkComponent(c).join()).toMatch(/arduinoPin 3 is used by both/);
  });

  it("MCU pin voltage disagrees with logic voltage", () => {
    const c = base("mcu.raspberry-pi-pico");
    const gp0 = c.pins.find((p) => p.id === "GP0");
    if (gp0) gp0.voltageDomainV = 5;
    expect(checkComponent(c).join()).toMatch(/"GP0" is 5 V but the MCU logic is 3.3 V/);
  });

  it("line sensor channel count mismatch", () => {
    const c = base("sensor.pololu-qtr-8a");
    c.pins = c.pins.filter((p) => p.id !== "OUT8");
    expect(checkComponent(c).join()).toMatch(/8 channels but 7 analog output/);
  });

  it("motor driver output count mismatch", () => {
    const c = base("driver.tb6612fng");
    c.pins = c.pins.filter((p) => p.id !== "BO2");
    expect(checkComponent(c).join()).toMatch(/need 4 motor outputs, found 3/);
  });

  it("battery without a negative terminal", () => {
    const c = base("battery.lipo-2s-450mah");
    c.pins = c.pins.filter((p) => !p.functions.includes("gnd"));
    expect(checkComponent(c).join()).toMatch(/battery: needs/);
  });

  it("ambiguous alias across components", () => {
    const a = base("driver.tb6612fng");
    const b = base("driver.drv8833-pololu");
    b.aliases = [...b.aliases, "TB6612"];
    expect(
      checkCatalog([a, b])
        .map((p) => p.message)
        .join(),
    ).toMatch(/"tb6612" is also used by driver.tb6612fng/);
  });
});
