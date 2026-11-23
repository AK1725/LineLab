import { getChassis, getComponent } from "@linelab/component-db";
import {
  applyCommand,
  autoWire,
  defaultPlacement,
  newDesign,
  type Lookup,
} from "@linelab/design-core";
import type { Chassis, Component, Design, DesignCommand, Finding } from "@linelab/schema";
import { runRules } from "../index.js";

export const baseLookup: Lookup = (id) => getComponent(id);

/** Lookup with some components' fields overridden (to put a rule's threshold within reach). */
export function lookupWith(overrides: Record<string, (c: Component) => Component>): Lookup {
  return (id) => {
    const c = getComponent(id);
    const f = overrides[id];
    return c && f ? f(structuredClone(c)) : c;
  };
}

export const GOOD_PARTS = [
  "mcu.arduino-nano",
  "driver.tb6612fng",
  "sensor.pololu-qtr-8a",
  "motor.pololu-hp-6v-30-1",
  "motor.pololu-hp-6v-30-1",
  "wheel.pololu-32x7",
  "wheel.pololu-32x7",
  "caster.nylon-skid",
  "regulator.pololu-d24v10f5",
  "battery.lipo-2s-300mah",
];

export interface Robot {
  design: Design;
  chassis: Chassis;
  lookup: Lookup;
}

/** Builds a robot by auto-placing and auto-wiring parts, then applying any rules-engine fixes. */
export function robot(
  opts: { parts?: string[]; chassis?: string; lookup?: Lookup; applyFixes?: boolean } = {},
): Robot {
  const lookup = opts.lookup ?? baseLookup;
  const chassis = getChassis(opts.chassis ?? "chassis.pcb-racer") as Chassis;
  let d = newDesign("test", "test", { kind: "template", chassisId: chassis.id });
  for (const id of opts.parts ?? GOOD_PARTS) {
    const c = lookup(id);
    if (!c) throw new Error(`unknown part ${id}`);
    d = applyCommand(d, { type: "add", placements: [defaultPlacement(c, d, chassis, lookup)] });
  }
  d = { ...d, netlist: autoWire(d, lookup) };
  let r: Robot = { design: d, chassis, lookup };
  if (opts.applyFixes !== false) {
    for (const f of findings(r).filter(
      (x) => x.fix && ["mech.sensor-height", "mech.caster-gap"].includes(x.id),
    )) {
      r = apply(r, ...(f.fix?.operations ?? []));
    }
  }
  return r;
}

export const findings = (r: Robot): Finding[] => runRules(r.design, r.chassis, r.lookup);
export const ids = (r: Robot) => new Set(findings(r).map((f) => f.id));

export function apply(r: Robot, ...cmds: DesignCommand[]): Robot {
  let d = r.design;
  for (const c of cmds) d = applyCommand(d, c);
  return { ...r, design: d };
}

export const e = (pinRef: string) => {
  const [instanceId, pinId] = pinRef.split(".") as [string, string];
  return { instanceId, pinId };
};
export const connect = (a: string, b: string): DesignCommand => ({
  type: "connect",
  a: e(a),
  b: e(b),
});
export const disconnect = (a: string): DesignCommand => ({ type: "disconnect", endpoint: e(a) });

/** An MCU pin with the wanted capabilities that nothing is wired to yet. */
export function freeMcuPin(r: Robot, pred: (fns: string[]) => boolean): string {
  const mcu = r.design.placements.find((p) => r.lookup(p.componentId)?.category === "mcu");
  const c = mcu && r.lookup(mcu.componentId);
  const used = new Set(
    r.design.netlist.flatMap((n) =>
      n.connections.filter((x) => x.instanceId === mcu?.instanceId).map((x) => x.pinId),
    ),
  );
  const pin = c?.pins.find(
    (p) => !used.has(p.id) && pred(p.functions) && !/USB serial/.test(p.notes ?? ""),
  );
  if (!mcu || !pin) throw new Error("no free MCU pin");
  return `${mcu.instanceId}.${pin.id}`;
}

export const move = (id: string, x: number, y: number, r: Robot): DesignCommand => {
  const p = r.design.placements.find((q) => q.instanceId === id);
  if (!p) throw new Error(id);
  return { type: "update", changes: [{ id, patch: { position: { ...p.position, x, y } } }] };
};
