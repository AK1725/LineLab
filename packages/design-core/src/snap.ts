import type { Chassis, Component, Vec2 } from "@linelab/schema";
import { isQuarterTurn, rotate } from "./placement.js";
import { bounds } from "./polygon.js";

export type SnapKind = "wheel-mount" | "caster-mount" | "mount-hole" | "edge" | "grid" | "none";

export interface SnapOptions {
  /** Grid pitch in mm; 0 disables grid snapping. */
  gridMm: number;
  /** Snap features (mounts, holes, edges) only within this distance (mm). */
  radiusMm?: number;
}

export interface SnapResult {
  x: number;
  y: number;
  kind: SnapKind;
}

const DEFAULTS = { mountRadius: 15, holeRadius: 3, edgeRadius: 2 };

/**
 * Snaps a part's desired centre. Priority: wheel/caster mounts, then mounting holes onto chassis
 * holes, then deck edges (for parts at 0/90/180/270°), then the grid.
 */
export function snapPosition(
  desired: Vec2,
  component: Component,
  yaw: number,
  chassis: Chassis,
  options: SnapOptions,
): SnapResult {
  const near = (a: Vec2, b: Vec2, r: number) => Math.hypot(a.x - b.x, a.y - b.y) <= r;

  if (component.category === "wheel") {
    const mount = chassis.wheelMounts
      .map((w) => w.position)
      .filter((m) => near(m, desired, options.radiusMm ?? DEFAULTS.mountRadius))
      .sort(
        (a, b) =>
          Math.hypot(a.x - desired.x, a.y - desired.y) -
          Math.hypot(b.x - desired.x, b.y - desired.y),
      )[0];
    if (mount) return { x: mount.x, y: mount.y, kind: "wheel-mount" };
  }
  if (component.category === "caster") {
    const mount = chassis.casterMounts
      .filter((m) => near(m, desired, options.radiusMm ?? DEFAULTS.mountRadius))
      .sort(
        (a, b) =>
          Math.hypot(a.x - desired.x, a.y - desired.y) -
          Math.hypot(b.x - desired.x, b.y - desired.y),
      )[0];
    if (mount) return { x: mount.x, y: mount.y, kind: "caster-mount" };
  }

  // Align one of the part's own mounting holes with a chassis hole.
  if (
    component.mountingHoles &&
    component.mountingHoles.length > 0 &&
    chassis.mountPoints.length > 0
  ) {
    let best: { dx: number; dy: number; d: number } | undefined;
    for (const h of component.mountingHoles) {
      const r = rotate({ x: h.x, y: h.y }, yaw);
      const at = { x: desired.x + r.x, y: desired.y + r.y };
      for (const m of chassis.mountPoints) {
        const d = Math.hypot(m.x - at.x, m.y - at.y);
        if (d <= DEFAULTS.holeRadius && (best === undefined || d < best.d))
          best = { dx: m.x - at.x, dy: m.y - at.y, d };
      }
    }
    if (best) return { x: desired.x + best.dx, y: desired.y + best.dy, kind: "mount-hole" };
  }

  let x = desired.x;
  let y = desired.y;
  let kind: SnapKind = "none";

  // Flush with the outline's bounding edges when the part is square to the chassis.
  if (isQuarterTurn(yaw)) {
    const swapped = Math.abs(Math.sin(yaw)) > 0.5;
    const hx = (swapped ? component.dimensionsMm.y : component.dimensionsMm.x) / 2;
    const hy = (swapped ? component.dimensionsMm.x : component.dimensionsMm.y) / 2;
    const b = bounds(chassis.outline);
    const r = DEFAULTS.edgeRadius;
    for (const target of [b.minX + hx, b.maxX - hx]) {
      if (Math.abs(x - target) <= r) {
        x = target;
        kind = "edge";
      }
    }
    for (const target of [b.minY + hy, b.maxY - hy]) {
      if (Math.abs(y - target) <= r) {
        y = target;
        kind = "edge";
      }
    }
  }

  if (options.gridMm > 0) {
    const g = options.gridMm;
    const snappedX = kind === "edge" && x !== desired.x ? x : Math.round(x / g) * g;
    const snappedY = kind === "edge" && y !== desired.y ? y : Math.round(y / g) * g;
    if (kind === "none") kind = "grid";
    x = snappedX;
    y = snappedY;
  }
  return { x, y, kind };
}
