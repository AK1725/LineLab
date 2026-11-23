import type { Lookup } from "@linelab/design-core";
import type { RobotModel } from "@linelab/sim-core";
import type { Component, Design, Net } from "@linelab/schema";
import { DRIVER_CHANNELS, channelDuty, type ChannelDef } from "./drivers.js";

/** Where a driver or sensor input gets its level from. */
export type LevelSource =
  { kind: "mcu"; pin: string } | { kind: "const"; level: number } | { kind: "float" };

export interface MotorBinding {
  side: "left" | "right";
  driverInstanceId: string;
  channel: ChannelDef;
  inputs: Record<string, LevelSource>;
  /** +1 if the channel's positive output reaches the motor's first terminal. */
  polarity: 1 | -1;
}

export interface SensorBinding {
  /** Index in RobotModel.sensors. */
  index: number;
  /** MCU pin the channel's output reaches (undefined: not wired). */
  mcuPin: string | undefined;
  /** Emitter control (QTR LEDON); undefined if the board has none. */
  emitters: LevelSource | undefined;
}

export interface FirmwareWiring {
  mcuInstanceId: string;
  mcu: Component;
  motors: MotorBinding[];
  sensors: SensorBinding[];
  /** Wiring that will stop the robot driving, in plain language. */
  problems: string[];
}

/** Which net holds this pin (undefined if unconnected). */
const netOf = (design: Design, instanceId: string, pinId: string): Net | undefined =>
  design.netlist.find((n) =>
    n.connections.some((c) => c.instanceId === instanceId && c.pinId === pinId),
  );

/**
 * The level source for a pin's net: an MCU pin, a fixed level (tied to a supply or ground),
 * or floating.
 */
function sourceFor(
  design: Design,
  lookup: Lookup,
  mcuInstanceId: string,
  instanceId: string,
  pinId: string,
): LevelSource {
  const net = netOf(design, instanceId, pinId);
  if (!net) return { kind: "float" };
  const mcuEnd = net.connections.find((c) => c.instanceId === mcuInstanceId);
  if (mcuEnd) {
    const pin = lookup(
      design.placements.find((p) => p.instanceId === mcuInstanceId)?.componentId ?? "",
    )?.pins.find((x) => x.id === mcuEnd.pinId);
    // An MCU power or ground pin is a fixed level, not a GPIO.
    if (pin?.functions.some((f) => f === "power_out" || f === "power_in"))
      return { kind: "const", level: 1 };
    if (pin?.functions.includes("gnd")) return { kind: "const", level: 0 };
    return { kind: "mcu", pin: mcuEnd.pinId };
  }
  for (const c of net.connections) {
    const comp = lookup(
      design.placements.find((p) => p.instanceId === c.instanceId)?.componentId ?? "",
    );
    const pin = comp?.pins.find((x) => x.id === c.pinId);
    if (!comp || !pin) continue;
    if (pin.functions.includes("gnd")) return { kind: "const", level: 0 };
    if (pin.functions.includes("power_out") || (comp.category === "battery" && /\+/.test(pin.id)))
      return { kind: "const", level: 1 };
  }
  return { kind: "float" };
}

/** Resolve how firmware reaches the motors and sensors through the design's netlist. */
export function resolveWiring(design: Design, lookup: Lookup, robot: RobotModel): FirmwareWiring {
  const problems: string[] = [];
  const mcuPlacement = design.placements.find((p) => lookup(p.componentId)?.category === "mcu");
  const mcu = mcuPlacement ? lookup(mcuPlacement.componentId) : undefined;
  if (!mcuPlacement || !mcu)
    throw new Error("The design has no microcontroller to run firmware on.");
  const mcuId = mcuPlacement.instanceId;

  const motors: MotorBinding[] = [];
  for (const wheel of robot.wheels) {
    const motorPlacement = design.placements.find((p) => p.instanceId === wheel.motorInstanceId);
    const motor = motorPlacement ? lookup(motorPlacement.componentId) : undefined;
    const [t1, t2] = motor?.pins ?? [];
    if (!motor || !t1 || !t2) continue;
    let found: MotorBinding | undefined;
    for (const p of design.placements) {
      const channels = DRIVER_CHANNELS[p.componentId];
      if (!channels) continue;
      for (const ch of channels) {
        const n0 = netOf(design, p.instanceId, ch.out[0]);
        const n1 = netOf(design, p.instanceId, ch.out[1]);
        const has = (n: Net | undefined, pin: string) =>
          n?.connections.some((c) => c.instanceId === wheel.motorInstanceId && c.pinId === pin) ??
          false;
        const polarity =
          has(n0, t1.id) && has(n1, t2.id) ? 1 : has(n0, t2.id) && has(n1, t1.id) ? -1 : 0;
        if (polarity === 0) continue;
        const inputs: Record<string, LevelSource> = {};
        for (const pin of [...Object.values(ch.pins), ...ch.enables.map((e) => e.pin)])
          inputs[pin] = sourceFor(design, lookup, mcuId, p.instanceId, pin);
        found = { side: wheel.side, driverInstanceId: p.instanceId, channel: ch, inputs, polarity };
        for (const [pin, src] of Object.entries(inputs)) {
          if (src.kind === "float" && ch.floating[pin] === undefined)
            problems.push(
              `${lookup(p.componentId)?.name ?? p.instanceId} ${pin} isn't connected, so the ${wheel.side} motor can't be driven.`,
            );
        }
        break;
      }
      if (found) break;
    }
    if (found) motors.push(found);
    else
      problems.push(
        `The ${wheel.side} motor isn't connected to both outputs of a motor driver channel.`,
      );
  }

  const sensors: SensorBinding[] = robot.sensors.map((s, index) => {
    const placement = design.placements.find((p) => p.instanceId === s.instanceId);
    const comp = placement ? lookup(placement.componentId) : undefined;
    const outputs =
      comp?.pins
        .filter((p) => p.functions.includes("analog") || p.functions.includes("digital"))
        .filter((p) => p.id !== "LEDON") ?? [];
    const pin =
      comp?.pins.find((p) => p.id === `OUT${s.channel}`) ??
      (outputs.length === 1 ? outputs[0] : undefined);
    const src = pin
      ? sourceFor(design, lookup, mcuId, s.instanceId, pin.id)
      : ({ kind: "float" } as const);
    const ledon = comp?.pins.some((p) => p.id === "LEDON")
      ? sourceFor(design, lookup, mcuId, s.instanceId, "LEDON")
      : undefined;
    return { index, mcuPin: src.kind === "mcu" ? src.pin : undefined, emitters: ledon };
  });
  const unwired = sensors.filter((s) => s.mcuPin === undefined).length;
  if (unwired > 0)
    problems.push(
      `${unwired} sensor channel(s) aren't connected to the microcontroller; firmware can't read them.`,
    );
  return { mcuInstanceId: mcuId, mcu, motors, sensors, problems };
}

/**
 * Motor duties from the current pin levels. `pinLevel(pin)` returns the MCU pin's output level
 * (0..1, a PWM duty for timer pins) or undefined if it isn't an output.
 */
export function motorCommand(
  w: FirmwareWiring,
  pinLevel: (mcuPin: string) => number | undefined,
): { left: number; right: number } {
  const out = { left: 0, right: 0 };
  for (const m of w.motors) {
    const level = (pin: string) => {
      const src = m.inputs[pin];
      if (!src || src.kind === "float") return m.channel.floating[pin] ?? 0;
      if (src.kind === "const") return src.level;
      return pinLevel(src.pin) ?? m.channel.floating[pin] ?? 0;
    };
    out[m.side] = Math.max(-1, Math.min(1, channelDuty(m.channel, level) * m.polarity));
  }
  return out;
}
