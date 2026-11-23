import type { Chassis, Component, Deck, Design, Placement, Quat, Vec2 } from "@linelab/schema";

export type Lookup = (componentId: string) => Component | undefined;

/** Rotation about +Z (yaw) as a unit quaternion. The editor only rotates about Z. */
export function quatFromYaw(yawRad: number): Quat {
  return { x: 0, y: 0, z: Math.sin(yawRad / 2), w: Math.cos(yawRad / 2) };
}

/** Yaw angle (radians, −π..π) of a quaternion, assuming rotation about Z only. */
export function yawOf(q: Quat): number {
  return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
}

export const normalizeAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Is the yaw a multiple of 90° (within 0.5°)? */
export function isQuarterTurn(yaw: number): boolean {
  const q = yaw / (Math.PI / 2);
  return Math.abs(q - Math.round(q)) < 0.5 / 90;
}

export function rotate(v: Vec2, yaw: number): Vec2 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** The chassis a design uses, resolved from a template lookup when needed. */
export function resolveChassis(
  design: Design,
  templates: (id: string) => Chassis | undefined,
): Chassis | undefined {
  return design.chassis.kind === "custom"
    ? design.chassis.chassis
    : templates(design.chassis.chassisId);
}

export function deckOf(chassis: Chassis, index: number): Deck | undefined {
  return chassis.decks.find((d) => d.index === index);
}

export function deckOutline(chassis: Chassis, deck: Deck) {
  return deck.outline ?? chassis.outline;
}

/**
 * Height (mm) of a part's bottom face. Wheels stand on the ground; everything else sits on top of
 * its deck or hangs underneath it, optionally on spacers (`standoffMm`).
 */
export function placementZ(
  chassis: Chassis,
  component: Component,
  deckIndex: number,
  mount: Placement["mount"],
  standoffMm = 0,
): number {
  if (component.category === "wheel") return 0;
  const deck = deckOf(chassis, deckIndex) ?? chassis.decks[0];
  if (deck === undefined) return 0;
  return mount === "top"
    ? deck.heightMm + standoffMm
    : deck.heightMm - chassis.thicknessMm - standoffMm - component.dimensionsMm.z;
}

/** Oriented footprint of a placed part in the chassis plane, plus its vertical extent. */
export interface Footprint {
  instanceId: string;
  center: Vec2;
  halfX: number;
  halfY: number;
  yaw: number;
  z0: number;
  z1: number;
}

export function footprint(p: Placement, c: Component): Footprint {
  return {
    instanceId: p.instanceId,
    center: { x: p.position.x, y: p.position.y },
    halfX: c.dimensionsMm.x / 2,
    halfY: c.dimensionsMm.y / 2,
    yaw: yawOf(p.rotation),
    z0: p.position.z,
    z1: p.position.z + c.dimensionsMm.z,
  };
}

export function footprintCorners(f: Footprint): Vec2[] {
  return [
    { x: -f.halfX, y: -f.halfY },
    { x: f.halfX, y: -f.halfY },
    { x: f.halfX, y: f.halfY },
    { x: -f.halfX, y: f.halfY },
  ].map((v) => {
    const r = rotate(v, f.yaw);
    return { x: f.center.x + r.x, y: f.center.y + r.y };
  });
}

/** Next free instance id for a component category, e.g. "motor3". */
export function nextInstanceId(design: Design, component: Component): string {
  const prefix = component.category.replace(/_/g, "-");
  const used = new Set(design.placements.map((p) => p.instanceId));
  for (let n = 1; ; n++) {
    const id = `${prefix}${n}`;
    if (!used.has(id)) return id;
  }
}
