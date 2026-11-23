import type { Chassis, Component, Design, Vec2 } from "@linelab/schema";
import {
  deckOutline,
  footprint,
  footprintCorners,
  type Footprint,
  type Lookup,
} from "./placement.js";
import { distanceToEdges, pointInPolygon, polygonsOverlap } from "./polygon.js";

/** Parts may touch; they collide only if they overlap by more than this (mm). */
export const COLLISION_TOLERANCE_MM = 0.05;

/** Separating-axis test for two oriented rectangles, shrunk by the tolerance. */
export function footprintsOverlap(
  a: Footprint,
  b: Footprint,
  tol = COLLISION_TOLERANCE_MM,
): boolean {
  if (Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) <= tol) return false;
  const axes: Vec2[] = [];
  for (const f of [a, b]) {
    axes.push(
      { x: Math.cos(f.yaw), y: Math.sin(f.yaw) },
      { x: -Math.sin(f.yaw), y: Math.cos(f.yaw) },
    );
  }
  const ca = footprintCorners(a);
  const cb = footprintCorners(b);
  for (const ax of axes) {
    const proj = (pts: Vec2[]) => {
      let min = Infinity;
      let max = -Infinity;
      for (const p of pts) {
        const d = p.x * ax.x + p.y * ax.y;
        min = Math.min(min, d);
        max = Math.max(max, d);
      }
      return { min, max };
    };
    const pa = proj(ca);
    const pb = proj(cb);
    if (Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min) <= tol) return false;
  }
  return true;
}

export interface Collision {
  a: string;
  /** Another instance id, or `chassis:<deck>` when a part passes through a deck plate. */
  b: string;
}

/** Parts that are round about Z: their footprint is the inscribed circle, not the box. */
export function isRoundAboutZ(c: Component): boolean {
  if (c.model.kind !== "procedural") return false;
  const g = c.model.generator;
  return (
    g === "edf_fan" ||
    g === "standoff" ||
    (g === "generic_cylinder" && (c.model.params.axis ?? 0) === 0)
  );
}

/** Motor shafts go into wheel hubs by design, so a motor and a wheel may overlap. */
const interlocks = (a: Component, b: Component) =>
  (a.category === "motor" && b.category === "wheel") ||
  (a.category === "wheel" && b.category === "motor");

/** All overlapping pairs of parts, plus parts that pass through a deck plate. */
export function findCollisions(design: Design, chassis: Chassis, lookup: Lookup): Collision[] {
  const prints: { f: Footprint; c: Component }[] = [];
  for (const p of design.placements) {
    const c = lookup(p.componentId);
    if (c) prints.push({ f: footprint(p, c), c });
  }
  const out: Collision[] = [];
  for (let i = 0; i < prints.length; i++) {
    for (let j = i + 1; j < prints.length; j++) {
      const a = prints[i] as { f: Footprint; c: Component };
      const b = prints[j] as { f: Footprint; c: Component };
      if (interlocks(a.c, b.c)) continue;
      if (footprintsOverlap(a.f, b.f)) out.push({ a: a.f.instanceId, b: b.f.instanceId });
    }
  }
  for (const { f, c } of prints) {
    for (const deck of chassis.decks) {
      const top = deck.heightMm;
      const bottom = top - chassis.thicknessMm;
      if (Math.min(f.z1, top) - Math.max(f.z0, bottom) <= COLLISION_TOLERANCE_MM) continue;
      const corners = footprintCorners(f);
      const outline = deckOutline(chassis, deck);
      const r = Math.min(f.halfX, f.halfY);
      const inCutout =
        deck.index === 0 &&
        (chassis.cutouts ?? []).some((cut) =>
          isRoundAboutZ(c)
            ? pointInPolygon(f.center, cut) &&
              distanceToEdges(f.center, cut) >= r - COLLISION_TOLERANCE_MM
            : corners.every((p) => pointInPolygon(p, cut)),
        );
      if (!inCutout && polygonsOverlap(corners, outline))
        out.push({ a: f.instanceId, b: `chassis:${deck.index}` });
    }
  }
  return out;
}

/** Instance ids that take part in any collision. */
export function collidingIds(collisions: readonly Collision[]): Set<string> {
  const s = new Set<string>();
  for (const c of collisions) {
    s.add(c.a);
    if (!c.b.startsWith("chassis:")) s.add(c.b);
  }
  return s;
}
