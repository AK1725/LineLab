import type { Chassis, Component, Design, Placement, Vec2 } from "@linelab/schema";
import { footprintsOverlap } from "./collision.js";
import {
  deckOf,
  deckOutline,
  footprint,
  footprintCorners,
  nextInstanceId,
  placementZ,
  quatFromYaw,
  type Lookup,
} from "./placement.js";
import { bounds, centroid, pointInPolygon } from "./polygon.js";

export function newDesign(id: string, name: string, chassis: Design["chassis"]): Design {
  return { id, name, version: 1, chassis, placements: [], netlist: [] };
}

const isMotor = (c: Component) => c.category === "motor";

/**
 * Picks a sensible first position for a newly added part, so a robot can be assembled by
 * clicking "Add": wheels go to free wheel mounts, motors line up behind them, line sensors go
 * under the nose, and everything else finds a free spot on the top deck.
 */
export function defaultPlacement(
  component: Component,
  design: Design,
  chassis: Chassis,
  lookup: Lookup,
): Placement {
  const instanceId = nextInstanceId(design, component);
  const placed = design.placements.flatMap((p) => {
    const c = lookup(p.componentId);
    return c ? [{ p, c }] : [];
  });
  const base = (pos: Vec2, yaw: number, mount: Placement["mount"], deck = 0): Placement => ({
    instanceId,
    componentId: component.id,
    position: { x: pos.x, y: pos.y, z: placementZ(chassis, component, deck, mount) },
    rotation: quatFromYaw(yaw),
    deck,
    mount,
    standoffMm: 0,
  });
  const used = (p: Vec2, category: Component["category"], r = 5) =>
    placed.some(
      (x) =>
        x.c.category === category && Math.hypot(x.p.position.x - p.x, x.p.position.y - p.y) < r,
    );

  if (component.category === "wheel") {
    const mount =
      chassis.wheelMounts.find((m) => !used(m.position, "wheel"))?.position ??
      chassis.wheelMounts[0]?.position;
    return base(mount ?? { x: 0, y: 0 }, 0, "top");
  }
  if (component.category === "caster") {
    const mount = chassis.casterMounts.find((m) => !used(m, "caster"));
    if (mount) return base(mount, 0, "bottom");
  }
  if (isMotor(component)) {
    // One motor per wheel mount, inboard of the wheel, shaft pointing at it.
    const motors = placed.filter((x) => isMotor(x.c));
    const taken = (m: Vec2) =>
      motors.some(
        (x) => Math.abs(x.p.position.x - m.x) < 25 && Math.sign(x.p.position.y) === Math.sign(m.y),
      );
    const mount = chassis.wheelMounts.find((m) => !taken(m.position));
    if (mount) {
      const wheel = placed.find(
        (x) =>
          x.c.category === "wheel" &&
          Math.hypot(x.p.position.x - mount.position.x, x.p.position.y - mount.position.y) < 5,
      );
      // Wheel not placed yet: assume a typical width for the wheel size the mount is built for.
      const wheelHalf = (wheel?.c.dimensionsMm.y ?? (mount.axleHeightMm > 25 ? 26 : 8)) / 2;
      const side = Math.sign(mount.position.y) || 1;
      const params = component.model.kind === "procedural" ? component.model.params : {};
      const gap = 1;
      if (component.model.kind === "procedural" && component.model.generator === "tt_motor") {
        // TT motors: body along X, double shaft along Y. The body face stops just short of the wheel.
        const shaft = Math.min(params.shaftLengthMm ?? 8, component.dimensionsMm.y * 0.3);
        const y =
          mount.position.y - side * (wheelHalf + gap + component.dimensionsMm.y / 2 - shaft);
        return base({ x: mount.position.x - component.dimensionsMm.x * 0.3, y }, 0, "bottom");
      }
      // Axial motors: shaft along local +X, turned to point at the wheel; the shaft enters the hub.
      const shaft = Math.min(params.shaftLengthMm ?? 10, component.dimensionsMm.x * 0.4);
      const y = mount.position.y - side * (wheelHalf + gap + component.dimensionsMm.x / 2 - shaft);
      return base({ x: mount.position.x, y }, side * (Math.PI / 2), "bottom");
    }
  }
  if (component.category === "line_sensor") {
    const front = bounds(chassis.outline).maxX;
    return base({ x: front - component.dimensionsMm.x / 2 - 1, y: 0 }, 0, "bottom");
  }

  // Everything else: nearest free spot on the top deck to a category-specific preferred point.
  const deck = deckOf(chassis, 0) ?? chassis.decks[0];
  const outline = deck ? deckOutline(chassis, deck) : chassis.outline;
  const b = bounds(outline);
  const c = centroid(outline);
  // Batteries at the back, drivers by the axle, boards ahead of the centre.
  const preferred: Vec2 =
    component.category === "battery"
      ? { x: b.minX + component.dimensionsMm.x / 2 + 2, y: 0 }
      : component.category === "motor_driver"
        ? { x: 0, y: 0 }
        : { x: (c.x + b.maxX) / 2, y: 0 };
  const candidate = base(preferred, 0, "top");
  const z = candidate.position.z;
  const others = placed.map((x) => footprint(x.p, x.c));
  const at = (pos: Vec2, yaw: number): Placement => ({
    ...candidate,
    position: { x: pos.x, y: pos.y, z },
    rotation: quatFromYaw(yaw),
  });
  const fits = (pl: Placement) => {
    const f = footprint(pl, component);
    return (
      footprintCorners(f).every((p) => pointInPolygon(p, outline)) &&
      !others.some((o) => footprintsOverlap(f, o))
    );
  };
  const step = 2.5;
  for (let ring = 0; ring < 80; ring++) {
    for (let i = -ring; i <= ring; i++) {
      for (const [dx, dy] of [
        [i, -ring],
        [i, ring],
        [-ring, i],
        [ring, i],
      ] as const) {
        const p = { x: preferred.x + dx * step, y: preferred.y + dy * step };
        for (const yaw of [0, Math.PI / 2]) {
          const pl = at(p, yaw);
          if (fits(pl)) return pl;
        }
      }
    }
  }
  return candidate; // No free spot: drop it at the preferred point and let the collision overlay show it.
}
