import type { Component } from "@linelab/schema";
import { buildComponentModel, checkComponentModel } from "@linelab/three-models";
import { Box3 } from "three";
import { compact } from "../text.js";

export interface CatalogProblem {
  id: string;
  message: string;
}

/** How far (mm) a generated model may poke outside `dimensionsMm` before it is reported. */
const FIT_TOLERANCE_MM = 0.6;

/** Per-component semantic checks that a JSON Schema cannot express. */
export function checkComponent(c: Component): string[] {
  const problems: string[] = [];

  // 3D model: generator exists, params valid, and the result fits the declared envelope.
  const modelProblems = checkComponentModel(c);
  problems.push(...modelProblems.map((m) => `model: ${m}`));
  if (modelProblems.length === 0) {
    const bb = new Box3().setFromObject(buildComponentModel(c));
    const d = c.dimensionsMm;
    const t = FIT_TOLERANCE_MM;
    if (
      bb.min.x < -d.x / 2 - t ||
      bb.max.x > d.x / 2 + t ||
      bb.min.y < -d.y / 2 - t ||
      bb.max.y > d.y / 2 + t ||
      bb.min.z < -t ||
      bb.max.z > d.z + t
    ) {
      const f = (n: number) => n.toFixed(1);
      problems.push(
        `model: generated model (${f(bb.max.x - bb.min.x)} × ${f(bb.max.y - bb.min.y)} × ${f(bb.max.z)} mm) does not fit dimensionsMm (${d.x} × ${d.y} × ${d.z})`,
      );
    }
  }

  // Firmware pin names must be unambiguous.
  const arduino = new Map<string, string>();
  for (const p of c.pins) {
    if (p.arduinoPin === undefined) continue;
    const key = String(p.arduinoPin);
    const other = arduino.get(key);
    if (other !== undefined)
      problems.push(`pins: arduinoPin ${key} is used by both "${other}" and "${p.id}"`);
    arduino.set(key, p.id);
  }

  const has = (fn: string) => c.pins.some((p) => p.functions.includes(fn as never));
  const e = c.electrical;

  switch (e.kind) {
    case "mcu": {
      for (const fn of ["gnd", "pwm", "analog"]) {
        if (!has(fn)) problems.push(`mcu: no pin with function "${fn}"`);
      }
      if (!has("power_in") && !has("power_out")) problems.push("mcu: no power pin");
      for (const p of c.pins) {
        const io = p.functions.some((f) => f === "digital" || f === "analog" || f === "pwm");
        if (
          io &&
          p.voltageDomainV !== undefined &&
          Math.abs(p.voltageDomainV - e.logicVoltageV) > 0.05
        ) {
          problems.push(
            `mcu: I/O pin "${p.id}" is ${p.voltageDomainV} V but the MCU logic is ${e.logicVoltageV} V`,
          );
        }
        if (e.fiveVoltTolerantIO && p.fiveVoltTolerant === false) {
          problems.push(
            `mcu: fiveVoltTolerantIO is true but pin "${p.id}" is marked not 5 V tolerant`,
          );
        }
      }
      break;
    }
    case "line_sensor": {
      const outputs = c.pins.filter((p) =>
        e.outputType === "analog"
          ? p.functions.includes("analog")
          : p.functions.includes("digital") && !p.functions.includes("enable"),
      );
      if (outputs.length !== e.channels) {
        problems.push(
          `line_sensor: ${e.channels} channels but ${outputs.length} ${e.outputType} output pin(s)`,
        );
      }
      if (e.channels > 1 && e.channelPitchMm <= 0)
        problems.push("line_sensor: multi-channel sensor needs channelPitchMm > 0");
      break;
    }
    case "motor_driver": {
      const outs = c.pins.filter((p) => p.functions.includes("motor_out")).length;
      if (outs !== e.channels * 2)
        problems.push(
          `motor_driver: ${e.channels} channel(s) need ${e.channels * 2} motor outputs, found ${outs}`,
        );
      if (e.peakCurrentPerChannelA < e.continuousCurrentPerChannelA)
        problems.push("motor_driver: peak current is below continuous current");
      break;
    }
    case "motor": {
      if (e.stallCurrentA <= e.noLoadCurrentA)
        problems.push("motor: stall current must exceed no-load current");
      break;
    }
    case "battery": {
      if (!has("power_out") || !has("gnd"))
        problems.push("battery: needs a power_out (+) and a gnd (−) pin");
      break;
    }
    case "wheel": {
      const d = c.dimensionsMm;
      if (d.x !== e.diameterMm || d.z !== e.diameterMm || d.y !== e.widthMm) {
        problems.push(
          `wheel: dimensionsMm must be (diameter × width × diameter) = (${e.diameterMm} × ${e.widthMm} × ${e.diameterMm})`,
        );
      }
      break;
    }
    default:
      break;
  }
  return problems;
}

/** Catalog-wide checks: per-component checks plus search-alias uniqueness. */
export function checkCatalog(components: readonly Component[]): CatalogProblem[] {
  const problems: CatalogProblem[] = [];
  for (const c of components) {
    for (const message of checkComponent(c)) problems.push({ id: c.id, message });
  }

  // An alias must point at exactly one component, otherwise search for it is ambiguous.
  const owner = new Map<string, string>();
  for (const c of components) {
    for (const key of new Set([c.name, ...c.aliases].map(compact))) {
      const other = owner.get(key);
      if (other !== undefined && other !== c.id) {
        problems.push({ id: c.id, message: `alias/name "${key}" is also used by ${other}` });
      } else {
        owner.set(key, c.id);
      }
    }
  }
  return problems;
}
