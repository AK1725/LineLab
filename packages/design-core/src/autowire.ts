import type { Component, Design, Net, NetEndpoint, Pin } from "@linelab/schema";
import { connectPins } from "./history.js";
import type { Lookup } from "./placement.js";

interface Part {
  id: string;
  c: Component;
}

const has = (p: Pin, ...fns: string[]) => fns.some((f) => p.functions.includes(f as never));
const isPower = (p: Pin) => has(p, "power_in", "power_out", "gnd");

/** Pins whose notes say they are risky to use for general I/O. */
const AVOID = /USB serial|Strapping|flash|Native USB|PSRAM|SWD|BOOT1|programming/i;

/** Motor-supply pin of a motor driver (vs. its logic supply). */
export function isMotorSupplyPin(driver: Component, pin: Pin): boolean {
  if (!has(pin, "power_in")) return false;
  if (/motor|^VM$|^VMOT$|^12V$|^B\+$/i.test(pin.id) || /motor/i.test(pin.label)) return true;
  // A driver with a single supply pin powers its motors from it.
  return driver.pins.filter((p) => has(p, "power_in")).length === 1;
}

/** Driver control inputs that need a PWM-capable MCU pin for speed control. */
export function needsPwm(driver: Component, pin: Pin): boolean {
  if (/PWM|^EN[AB]$|^[RL]PWM$/i.test(pin.id)) return true;
  // Drivers without a dedicated PWM pin are speed-controlled by PWM on their IN pins.
  const dedicated = driver.pins.some((p) => /PWM|^EN[AB]$/i.test(p.id));
  return !dedicated && has(pin, "pwm");
}

/** "Pull high to run" enable pins (TB6612 STBY): tie them to the logic supply. */
export const mustPullHigh = (pin: Pin) => /pull high to run/i.test(pin.label) || pin.id === "STBY";

function driverInputs(c: Component): Pin[] {
  return c.pins.filter(
    (p) =>
      !isPower(p) &&
      !has(p, "motor_out") &&
      has(p, "digital", "pwm") &&
      !/FAULT|FLT|_IS$|^PG$|MODE/i.test(p.id),
  );
}

/**
 * Proposes a complete netlist for a line follower made of an MCU, motor drivers, motors, line
 * sensors, a battery and optional regulators, I2C devices and encoders. The result is a starting
 * point: every connection is visible and editable, and the rules engine checks it like any other.
 */
export function autoWire(design: Design, lookup: Lookup): Net[] {
  const parts: Part[] = design.placements.flatMap((p) => {
    const c = lookup(p.componentId);
    return c ? [{ id: p.instanceId, c }] : [];
  });
  const mcu = parts.find((p) => p.c.category === "mcu");
  const drivers = parts.filter((p) => p.c.category === "motor_driver");
  const motors = parts.filter((p) => p.c.category === "motor");
  const sensors = parts.filter((p) => p.c.category === "line_sensor");
  const battery = parts.find((p) => p.c.category === "battery");
  const regulators = parts.filter((p) => p.c.category === "regulator");
  const i2cDevices = parts.filter(
    (p) => p.c.category !== "mcu" && p.c.pins.some((q) => has(q, "i2c_sda")),
  );
  const encoders = parts.filter(
    (p) => p.c.category === "sensor" && /encoder|speed/i.test(p.c.name),
  );

  let nets: Net[] = [];
  const named = new Map<string, NetEndpoint>(); // net name → first endpoint
  const join = (name: string, e: NetEndpoint) => {
    const first = named.get(name);
    if (!first) {
      named.set(name, e);
      return;
    }
    nets = connectPins(nets, first, e, name);
    // Keep the readable name on the net that now holds `first`.
    nets = nets.map((n) =>
      n.connections.some((c) => c.instanceId === first.instanceId && c.pinId === first.pinId)
        ? { ...n, name }
        : n,
    );
  };
  const ep = (p: Part, pin: Pin): NetEndpoint => ({ instanceId: p.id, pinId: pin.id });
  const wire = (a: NetEndpoint, b: NetEndpoint, name: string) => {
    nets = connectPins(nets, a, b, name);
  };

  const wired = [
    mcu,
    ...drivers,
    ...sensors,
    battery,
    ...regulators,
    ...i2cDevices,
    ...encoders,
  ].filter((p): p is Part => p !== undefined);

  // Ground: every ground pin of every wired part.
  for (const p of wired)
    for (const pin of p.c.pins.filter((q) => has(q, "gnd"))) join("GND", ep(p, pin));

  // Battery → motor supplies, regulator inputs, and the MCU's raw input if it tolerates it.
  const batPlus = battery?.c.pins.find((q) => has(q, "power_out"));
  const batSpec = battery?.c.electrical.kind === "battery" ? battery.c.electrical : undefined;
  if (battery && batPlus) join("VBAT", ep(battery, batPlus));
  for (const d of drivers)
    for (const pin of d.c.pins.filter((q) => isMotorSupplyPin(d.c, q))) join("VBAT", ep(d, pin));
  for (const r of regulators)
    for (const pin of r.c.pins.filter((q) => has(q, "power_in") && !has(q, "enable")))
      join("VBAT", ep(r, pin));

  // Logic supply: the MCU's own regulated output at its logic voltage.
  const mcuSpec = mcu?.c.electrical.kind === "mcu" ? mcu.c.electrical : undefined;
  const logicPin = mcu?.c.pins.find(
    (q) => has(q, "power_out") && q.voltageDomainV === mcuSpec?.logicVoltageV,
  );
  const logicName = mcuSpec ? `${mcuSpec.logicVoltageV}V` : "VCC";
  if (mcu && logicPin) join(logicName, ep(mcu, logicPin));

  // MCU power input. Preference: battery straight into VIN when it stays in range even when
  // nearly empty; else a fixed regulator into VIN (if in range) or into the logic-voltage pin;
  // else the battery into VIN when its nominal voltage is in range (the rules engine then warns).
  if (mcu && mcuSpec) {
    const inputs = mcu.c.pins.filter(
      (q) => has(q, "power_in") && !has(q, "power_out") && !/AREF|ADC_VREF/i.test(q.id),
    );
    const raw = inputs.find((q) => /VIN|RAW|VSYS/i.test(q.id)) ?? inputs[0];
    const inRange = (lo: number, hi: number) =>
      lo >= mcuSpec.inputVoltage.min && hi <= mcuSpec.inputVoltage.max;
    const fixedRegs = regulators.filter(
      (r) =>
        r.c.electrical.kind === "regulator" &&
        r.c.electrical.outputVoltage.min === r.c.electrical.outputVoltage.max,
    );
    const outV = (r: Part) =>
      r.c.electrical.kind === "regulator" ? r.c.electrical.outputVoltage.max : 0;
    const regToRaw = fixedRegs.find((r) => inRange(outV(r), outV(r)));
    const regToLogic = fixedRegs.find((r) => Math.abs(outV(r) - mcuSpec.logicVoltageV) < 0.05);
    const regOut = (r: Part) => r.c.pins.find((q) => has(q, "power_out"));
    if (raw && batSpec && inRange(batSpec.cutoffVoltageV, batSpec.fullVoltageV)) {
      join("VBAT", ep(mcu, raw));
    } else if (raw && regToRaw && regOut(regToRaw)) {
      const name = `${outV(regToRaw)}V_REG`;
      join(name, ep(regToRaw, regOut(regToRaw) as Pin));
      join(name, ep(mcu, raw));
    } else if (regToLogic && regOut(regToLogic) && logicPin) {
      join(logicName, ep(regToLogic, regOut(regToLogic) as Pin));
    } else if (raw && batSpec && inRange(batSpec.nominalVoltageV, batSpec.fullVoltageV)) {
      join("VBAT", ep(mcu, raw));
    }
  }

  // MCU signal pin pools.
  const used = new Set<string>();
  const mcuPins = (mcu?.c.pins ?? []).filter(
    (q) => !isPower(q) && !has(q, "reset") && !AVOID.test(q.notes ?? ""),
  );
  const take = (
    pred: (q: Pin) => boolean,
    prefer: (q: Pin) => number = () => 0,
  ): Pin | undefined => {
    const pin = mcuPins
      .filter((q) => !used.has(q.id) && pred(q))
      .sort((a, b) => prefer(a) - prefer(b))[0];
    if (pin) used.add(pin.id);
    return pin;
  };
  const output = (q: Pin) => q.inputOnly !== true && has(q, "digital");
  // Keep analog-capable pins for sensors and PWM pins for speed when possible.
  const plainFirst = (q: Pin) => (has(q, "analog") ? 2 : 0) + (has(q, "pwm") ? 1 : 0);

  // Motor drivers: speed pins on PWM, the rest on plain digital pins; STBY tied to logic supply.
  for (const d of drivers) {
    for (const pin of d.c.pins.filter((q) => has(q, "power_in") && !isMotorSupplyPin(d.c, q)))
      join(logicName, ep(d, pin));
    for (const pin of d.c.pins.filter(mustPullHigh)) join(logicName, ep(d, pin));
    if (!mcu) continue;
    const inputs = driverInputs(d.c).filter((q) => !mustPullHigh(q));
    for (const pin of inputs.filter((q) => needsPwm(d.c, q))) {
      const m = take(
        (q) => output(q) && has(q, "pwm"),
        (q) => (has(q, "analog") ? 1 : 0),
      );
      if (m) wire(ep(mcu, m), ep(d, pin), pin.id);
    }
    for (const pin of inputs.filter((q) => !needsPwm(d.c, q) && !has(q, "enable"))) {
      const m = take(output, plainFirst);
      if (m) wire(ep(mcu, m), ep(d, pin), pin.id);
    }
  }

  // Motors onto driver output pairs, in order.
  const outPairs: [NetEndpoint, NetEndpoint][] = [];
  for (const d of drivers) {
    const outs = d.c.pins.filter((q) => has(q, "motor_out"));
    for (let i = 0; i + 1 < outs.length; i += 2)
      outPairs.push([ep(d, outs[i] as Pin), ep(d, outs[i + 1] as Pin)]);
  }
  motors.forEach((m, i) => {
    const pair = outPairs[i];
    const terms = m.c.pins.filter((q) => /^M[+-]$/.test(q.id));
    if (!pair || terms.length < 2) return;
    wire(ep(m, terms[0] as Pin), pair[0], `${m.id}+`);
    wire(ep(m, terms[1] as Pin), pair[1], `${m.id}-`);
    for (const pin of m.c.pins.filter((q) => has(q, "gnd"))) join("GND", ep(m, pin));
    for (const pin of m.c.pins.filter((q) => q.id === "VCC")) join(logicName, ep(m, pin));
    if (mcu) {
      for (const pin of m.c.pins.filter((q) => /^C[12]$/.test(q.id))) {
        const target = take(
          (q) => has(q, "digital"),
          (q) => (/interrupt/i.test(q.notes ?? "") ? -1 : plainFirst(q)),
        );
        if (target) wire(ep(mcu, target), ep(m, pin), `${m.id}.${pin.id}`);
      }
    }
  });

  // Line sensors: supply from logic (or 5 V regulator if logic is too low), outputs to ADC/digital pins.
  for (const s of sensors) {
    const spec = s.c.electrical.kind === "line_sensor" ? s.c.electrical : undefined;
    const supply = logicName;
    for (const pin of s.c.pins.filter((q) => has(q, "power_in"))) join(supply, ep(s, pin));
    if (!mcu || !spec) continue;
    const outs = s.c.pins.filter(
      (q) =>
        !isPower(q) &&
        !has(q, "enable") &&
        (spec.outputType === "analog" ? has(q, "analog") : has(q, "digital")),
    );
    for (const pin of outs) {
      const m =
        spec.outputType === "analog"
          ? take(
              (q) => has(q, "analog"),
              (q) => (q.adcUnit === 2 ? 10 : 0) + (has(q, "pwm") ? 1 : 0),
            )
          : take(
              (q) => has(q, "digital"),
              (q) => (has(q, "pwm") ? 1 : 0),
            );
      if (m) wire(ep(mcu, m), ep(s, pin), `${s.id}.${pin.id}`);
    }
  }

  // I2C devices and encoders.
  const sda = mcu?.c.pins.find((q) => has(q, "i2c_sda"));
  const scl = mcu?.c.pins.find((q) => has(q, "i2c_scl"));
  for (const dev of i2cDevices) {
    for (const pin of dev.c.pins.filter((q) => has(q, "power_in"))) join(logicName, ep(dev, pin));
    const dSda = dev.c.pins.find((q) => has(q, "i2c_sda"));
    const dScl = dev.c.pins.find((q) => has(q, "i2c_scl"));
    if (mcu && sda && dSda) {
      join("SDA", ep(mcu, sda));
      join("SDA", ep(dev, dSda));
    }
    if (mcu && scl && dScl) {
      join("SCL", ep(mcu, scl));
      join("SCL", ep(dev, dScl));
    }
    if (sda) used.add(sda.id);
    if (scl) used.add(scl.id);
  }
  for (const e of encoders) {
    for (const pin of e.c.pins.filter((q) => has(q, "power_in"))) join(logicName, ep(e, pin));
    if (!mcu) continue;
    for (const pin of e.c.pins.filter((q) => !isPower(q) && has(q, "digital"))) {
      const m = take(
        (q) => has(q, "digital"),
        (q) => (/interrupt/i.test(q.notes ?? "") ? -1 : plainFirst(q)),
      );
      if (m) wire(ep(mcu, m), ep(e, pin), `${e.id}.${pin.id}`);
    }
  }

  return nets.filter((n) => n.connections.length >= 2);
}
