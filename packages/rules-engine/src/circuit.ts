import { isMotorSupplyPin, type Lookup } from "@linelab/design-core";
import type { Chassis, Component, Design, Net, Pin, Range } from "@linelab/schema";

export interface PartRef {
  id: string;
  c: Component;
}

export interface PinRef {
  part: PartRef;
  pin: Pin;
}

export interface NetInfo {
  net: Net;
  pins: PinRef[];
  isGround: boolean;
  /** Voltage sources on the net (battery +, regulator outputs, MCU supply outputs). */
  sources: { ref: PinRef; voltage: Range | undefined }[];
  /** Union of the known source voltages; undefined if nothing known drives the net. */
  voltage: Range | undefined;
}

export interface Circuit {
  design: Design;
  chassis: Chassis;
  lookup: Lookup;
  parts: PartRef[];
  partById: Map<string, PartRef>;
  nets: NetInfo[];
  netOfPin: Map<string, NetInfo>;
  /** Net of a pin, by instance id and pin id. */
  net(instanceId: string, pinId: string): NetInfo | undefined;
  /** Highest signal level (V) any other pin drives onto this net. */
  driveLevel(info: NetInfo, except?: PinRef): number | undefined;
  /** Supply voltage a part receives on a power-input pin, if known. */
  supplyOf(part: PartRef): Range | undefined;
}

export const has = (p: Pin, ...fns: string[]) => fns.some((f) => p.functions.includes(f as never));
export const isPowerPin = (p: Pin) => has(p, "power_in", "power_out", "gnd");
const key = (inst: string, pin: string) => `${inst}/${pin}`;

/** Voltage a power-output pin provides, if the part's data says. */
function sourceVoltage(part: PartRef, pin: Pin): Range | undefined {
  const e = part.c.electrical;
  if (e.kind === "battery") return { min: e.cutoffVoltageV, max: e.fullVoltageV };
  if (e.kind === "regulator") {
    // Adjustable regulators: the set-point is unknown.
    return e.outputVoltage.min === e.outputVoltage.max ? { ...e.outputVoltage } : undefined;
  }
  if (has(pin, "power_in")) return undefined; // bidirectional supply pins (L298N 5V) are not sources
  if (pin.voltageDomainV !== undefined) return { min: pin.voltageDomainV, max: pin.voltageDomainV };
  return undefined;
}

export function buildCircuit(design: Design, chassis: Chassis, lookup: Lookup): Circuit {
  const parts: PartRef[] = design.placements.flatMap((p) => {
    const c = lookup(p.componentId);
    return c ? [{ id: p.instanceId, c }] : [];
  });
  const partById = new Map(parts.map((p) => [p.id, p]));
  const nets: NetInfo[] = [];
  const netOfPin = new Map<string, NetInfo>();

  for (const net of design.netlist) {
    const pins: PinRef[] = [];
    for (const e of net.connections) {
      const part = partById.get(e.instanceId);
      const pin = part?.c.pins.find((p) => p.id === e.pinId);
      if (part && pin) pins.push({ part, pin });
    }
    const sources = pins
      .filter((r) => has(r.pin, "power_out") && !has(r.pin, "gnd"))
      .map((ref) => ({ ref, voltage: sourceVoltage(ref.part, ref.pin) }));
    const known = sources.map((s) => s.voltage).filter((v): v is Range => v !== undefined);
    const info: NetInfo = {
      net,
      pins,
      isGround: pins.some((r) => has(r.pin, "gnd")),
      sources,
      voltage:
        known.length > 0
          ? { min: Math.min(...known.map((v) => v.min)), max: Math.max(...known.map((v) => v.max)) }
          : undefined,
    };
    nets.push(info);
    for (const r of pins) netOfPin.set(key(r.part.id, r.pin.id), info);
  }

  const supplyOf = (part: PartRef): Range | undefined => {
    const supplies = part.c.pins
      .filter(
        (p) =>
          has(p, "power_in") &&
          !(part.c.category === "motor_driver" && isMotorSupplyPin(part.c, p)),
      )
      .map((p) => netOfPin.get(key(part.id, p.id))?.voltage)
      .filter((v): v is Range => v !== undefined);
    return supplies[0];
  };

  /** Signal level a pin drives: its own domain, or the supply of the part (sensor outputs). */
  const levelOf = (r: PinRef): number | undefined => {
    if (isPowerPin(r.pin) || has(r.pin, "motor_out")) return undefined;
    const drives =
      r.part.c.category === "mcu"
        ? has(r.pin, "digital", "pwm", "uart_tx", "spi_mosi", "spi_sck", "spi_cs") &&
          r.pin.inputOnly !== true
        : has(r.pin, "uart_tx", "analog", "digital") &&
          !has(r.pin, "enable") &&
          ["line_sensor", "sensor", "communication"].includes(r.part.c.category);
    if (!drives) return undefined;
    if (r.pin.voltageDomainV !== undefined) return r.pin.voltageDomainV;
    if (r.part.c.electrical.kind === "mcu") return r.part.c.electrical.logicVoltageV;
    return supplyOf(r.part)?.max;
  };

  return {
    design,
    chassis,
    lookup,
    parts,
    partById,
    nets,
    netOfPin,
    net: (i, p) => netOfPin.get(key(i, p)),
    driveLevel: (info, except) => {
      const levels = info.pins
        .filter((r) => r !== except)
        .map(levelOf)
        .filter((v): v is number => v !== undefined);
      const supply = info.voltage?.max;
      const all = supply !== undefined ? [...levels, supply] : levels;
      return all.length > 0 ? Math.max(...all) : undefined;
    },
    supplyOf,
  };
}

/** The voltage range a part accepts on a given power-input pin, from its electrical spec. */
export function acceptedSupply(part: PartRef, pin: Pin): Range | undefined {
  const e = part.c.electrical;
  switch (e.kind) {
    case "line_sensor":
      return e.supplyVoltage;
    case "motor_driver":
      return isMotorSupplyPin(part.c, pin) ? e.motorVoltage : e.logicVoltage;
    case "regulator":
      return e.inputVoltage;
    case "mcu":
      if (
        pin.voltageDomainV !== undefined &&
        /VBUS|^5V$|3V3|VCC/i.test(pin.id) &&
        !/VIN|RAW|VSYS/i.test(pin.id)
      ) {
        return part.c.pins.some((p) => /VIN|RAW|VSYS/i.test(p.id))
          ? { min: pin.voltageDomainV * 0.95, max: pin.voltageDomainV * 1.05 }
          : e.inputVoltage;
      }
      return /AREF|ADC_VREF/i.test(pin.id) ? undefined : e.inputVoltage;
    case "generic":
      return e.supplyVoltage;
    default:
      return undefined;
  }
}

export const mcuOf = (c: Circuit) => c.parts.find((p) => p.c.category === "mcu");
export const partsOf = (c: Circuit, cat: Component["category"]) =>
  c.parts.filter((p) => p.c.category === cat);
export const isConnected = (c: Circuit, part: PartRef) =>
  part.c.pins.some((p) => c.netOfPin.has(key(part.id, p.id)));
