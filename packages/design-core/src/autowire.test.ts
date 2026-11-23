import { getChassis, getComponent } from "@linelab/component-db";
import type { Chassis, Design } from "@linelab/schema";
import { describe, expect, it } from "vitest";
import { autoWire } from "./autowire.js";
import { defaultPlacement, newDesign } from "./defaults.js";
import { applyCommand } from "./history.js";

const lookup = (id: string) => getComponent(id);

function robot(chassisId: string, ids: string[]): Design {
  const ch = getChassis(chassisId) as Chassis;
  let d = newDesign("d", "d", { kind: "template", chassisId });
  for (const id of ids) {
    const c = getComponent(id);
    if (!c) throw new Error(id);
    d = applyCommand(d, { type: "add", placements: [defaultPlacement(c, d, ch, lookup)] });
  }
  return d;
}

const netOf = (d: Design, inst: string, pin: string) =>
  d.netlist.find((n) => n.connections.some((c) => c.instanceId === inst && c.pinId === pin));

describe("autoWire", () => {
  const d0 = robot("chassis.pcb-racer", [
    "mcu.arduino-nano",
    "driver.tb6612fng",
    "sensor.pololu-qtr-8a",
    "motor.pololu-hp-6v-30-1",
    "motor.pololu-hp-6v-30-1",
    "battery.lipo-2s-300mah",
  ]);
  const d = { ...d0, netlist: autoWire(d0, lookup) };

  it("joins every ground into one GND net", () => {
    const gnd = d.netlist.filter((n) => n.name === "GND");
    expect(gnd).toHaveLength(1);
    for (const inst of ["mcu1", "motor-driver1", "line-sensor1", "battery1"]) {
      expect(gnd[0]?.connections.some((c) => c.instanceId === inst)).toBe(true);
    }
  });

  it("puts battery, motor supply and the Nano VIN on VBAT; logic and STBY on 5 V", () => {
    const vbat = netOf(d, "battery1", "BAT+");
    expect(vbat?.name).toBe("VBAT");
    expect(netOf(d, "motor-driver1", "VMOT")?.id).toBe(vbat?.id);
    expect(netOf(d, "mcu1", "VIN")?.id).toBe(vbat?.id);
    const five = netOf(d, "mcu1", "5V");
    expect(netOf(d, "motor-driver1", "VCC")?.id).toBe(five?.id);
    expect(netOf(d, "motor-driver1", "STBY")?.id).toBe(five?.id);
    expect(netOf(d, "line-sensor1", "VCC")?.id).toBe(five?.id);
  });

  it("drives PWMA/PWMB from PWM pins and sensor outputs into ADC pins", () => {
    const nano = getComponent("mcu.arduino-nano");
    const mcuPin = (net: ReturnType<typeof netOf>) => {
      const id = net?.connections.find((c) => c.instanceId === "mcu1")?.pinId;
      return nano?.pins.find((p) => p.id === id);
    };
    for (const p of ["PWMA", "PWMB"])
      expect(mcuPin(netOf(d, "motor-driver1", p))?.functions).toContain("pwm");
    for (const p of ["AIN1", "AIN2", "BIN1", "BIN2"])
      expect(mcuPin(netOf(d, "motor-driver1", p))).toBeDefined();
    for (let i = 1; i <= 8; i++)
      expect(mcuPin(netOf(d, "line-sensor1", `OUT${i}`))?.functions).toContain("analog");
    // Serial pins D0/D1 are never used.
    const used = d.netlist.flatMap((n) =>
      n.connections.filter((c) => c.instanceId === "mcu1").map((c) => c.pinId),
    );
    expect(used).not.toContain("D0");
    expect(used).not.toContain("D1");
    const signals = used.filter((u) => !["GND", "GND2", "5V", "VIN"].includes(u));
    expect(new Set(signals).size).toBe(signals.length); // no MCU pin used twice
  });

  it("connects each motor to its own driver output pair", () => {
    expect(netOf(d, "motor1", "M+")?.connections.some((c) => c.pinId === "AO1")).toBe(true);
    expect(netOf(d, "motor1", "M-")?.connections.some((c) => c.pinId === "AO2")).toBe(true);
    expect(netOf(d, "motor2", "M+")?.connections.some((c) => c.pinId === "BO1")).toBe(true);
  });

  it("prefers a 5 V regulator into the Nano's 5 V pin over a sagging 2S pack on VIN", () => {
    const r0 = robot("chassis.pcb-racer", [
      "mcu.arduino-nano",
      "driver.tb6612fng",
      "regulator.pololu-d24v10f5",
      "battery.lipo-2s-300mah",
    ]);
    const r = { ...r0, netlist: autoWire(r0, lookup) };
    expect(netOf(r, "mcu1", "VIN")).toBeUndefined();
    expect(
      netOf(r, "mcu1", "5V")?.connections.some(
        (c) => c.instanceId === "regulator1" && c.pinId === "VOUT",
      ),
    ).toBe(true);
  });

  it("feeds an ESP32 through a regulator and prefers ADC1 pins for the sensors", () => {
    const e0 = robot("chassis.starter-2wd", [
      "mcu.esp32-devkitc",
      "driver.tb6612fng",
      "sensor.pololu-qtr-8a",
      "regulator.pololu-d24v10f5",
      "battery.lipo-2s-450mah",
    ]);
    const e = { ...e0, netlist: autoWire(e0, lookup) };
    expect(
      netOf(e, "mcu1", "5V")?.connections.some(
        (c) => c.instanceId === "regulator1" && c.pinId === "VOUT",
      ),
    ).toBe(true);
    expect(netOf(e, "mcu1", "5V")?.connections.some((c) => c.instanceId === "battery1")).toBe(
      false,
    );
    const esp = getComponent("mcu.esp32-devkitc");
    const adcUnits = Array.from({ length: 8 }, (_, i) => {
      const id = netOf(e, "line-sensor1", `OUT${i + 1}`)?.connections.find(
        (c) => c.instanceId === "mcu1",
      )?.pinId;
      return esp?.pins.find((p) => p.id === id)?.adcUnit;
    });
    // Only six ADC1 inputs exist on the DevKitC; the rest fall back to ADC2.
    expect(adcUnits.filter((u) => u === 1)).toHaveLength(6);
  });
});
