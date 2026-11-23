import type { Chassis, Design, Range } from "@linelab/schema";
import type { Lookup } from "./placement.js";

export interface Measurements {
  /** Distance between left and right wheel centres (mm). */
  trackWidthMm?: number;
  /** Front-to-back distance between the drive axle and the farthest other support (caster or axle). */
  wheelbaseMm?: number;
  /** X of the drive axle (mean wheel x, mm). */
  driveAxleX?: number;
  /** How far the front line sensor sits ahead of the drive axle (mm). */
  lookaheadMm?: number;
  /** Height of the front line sensor's face above the track (mm). */
  sensorClearanceMm?: number;
  /** The front sensor's recommended height range, from the component database. */
  sensorOptimalMm?: Range;
  /** Gap between each caster's bottom and the ground (mm): > 0 floats, < 0 lifts the wheels. */
  casterGapsMm: { instanceId: string; gapMm: number }[];
}

export function measure(design: Design, _chassis: Chassis, lookup: Lookup): Measurements {
  const placed = design.placements.flatMap((p) => {
    const c = lookup(p.componentId);
    return c ? [{ p, c }] : [];
  });
  const wheels = placed.filter((x) => x.c.category === "wheel");
  const casters = placed.filter((x) => x.c.category === "caster");
  const sensors = placed.filter((x) => x.c.category === "line_sensor");
  const out: Measurements = { casterGapsMm: [] };

  if (wheels.length > 0) {
    const ys = wheels.map((w) => w.p.position.y);
    const xs = wheels.map((w) => w.p.position.x);
    const left = ys.filter((y) => y > 0);
    const right = ys.filter((y) => y < 0);
    if (left.length > 0 && right.length > 0) {
      out.trackWidthMm = Math.max(...left) - Math.min(...right);
    }
    const front = Math.max(...xs);
    const rear = Math.min(...xs);
    const axleX = xs.reduce((s, x) => s + x, 0) / xs.length;
    out.driveAxleX = axleX;
    if (front - rear > 1) {
      out.wheelbaseMm = front - rear; // 4WD: axle to axle
    } else if (casters.length > 0) {
      out.wheelbaseMm = Math.max(...casters.map((c) => Math.abs(c.p.position.x - axleX)));
    }
  }

  if (sensors.length > 0) {
    const frontSensor = sensors.reduce((a, b) => (b.p.position.x > a.p.position.x ? b : a));
    out.sensorClearanceMm = frontSensor.p.position.z;
    if (frontSensor.c.electrical.kind === "line_sensor")
      out.sensorOptimalMm = frontSensor.c.electrical.optimalHeightMm;
    if (out.driveAxleX !== undefined) out.lookaheadMm = frontSensor.p.position.x - out.driveAxleX;
  }

  out.casterGapsMm = casters.map((c) => ({ instanceId: c.p.instanceId, gapMm: c.p.position.z }));
  return out;
}
