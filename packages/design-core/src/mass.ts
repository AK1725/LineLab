import type { Chassis, Design, Vec3 } from "@linelab/schema";
import { deckOutline, type Lookup } from "./placement.js";
import { area, centroid } from "./polygon.js";

export const DEFAULT_HOLE_DIAMETER_MM = 3.2;

/** Typical densities (g/cm³) used to pre-fill the custom chassis form. */
export const MATERIAL_DENSITY_GCM3 = {
  acrylic: 1.18,
  fr4: 1.85,
  pla: 1.24,
  petg: 1.27,
  carbon_fiber: 1.6,
  aluminium: 2.7,
  plywood: 0.6,
} as const satisfies Record<Chassis["material"], number>;

export interface MassProps {
  massG: number;
  cog: Vec3;
}

/**
 * Mass and centre of gravity of the chassis plates. Each deck is a flat plate of the chassis
 * thickness; deck 0 loses its cutouts; every deck that uses the main outline loses the mounting
 * holes (they are drilled through all of them).
 */
export function chassisMassProps(chassis: Chassis): MassProps {
  const holeR = (chassis.mountHoleDiameterMm ?? DEFAULT_HOLE_DIAMETER_MM) / 2;
  const holeArea = Math.PI * holeR * holeR;
  let mass = 0;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (const deck of chassis.decks) {
    const outline = deckOutline(chassis, deck);
    const c = centroid(outline);
    let a = area(outline);
    let ax = a * c.x;
    let ay = a * c.y;
    const removed = [
      ...(deck.index === 0
        ? (chassis.cutouts ?? []).map((cut) => ({ a: area(cut), c: centroid(cut) }))
        : []),
      ...(deck.outline === undefined
        ? chassis.mountPoints.map((p) => ({ a: holeArea, c: p }))
        : []),
    ];
    for (const r of removed) {
      a -= r.a;
      ax -= r.a * r.c.x;
      ay -= r.a * r.c.y;
    }
    // mm³ × g/cm³ ÷ 1000 = g
    const m = (a * chassis.thicknessMm * chassis.densityGcm3) / 1000;
    mass += m;
    mx += m * (ax / a);
    my += m * (ay / a);
    mz += m * (deck.heightMm - chassis.thicknessMm / 2);
  }
  return mass > 0
    ? { massG: mass, cog: { x: mx / mass, y: my / mass, z: mz / mass } }
    : { massG: 0, cog: { x: 0, y: 0, z: 0 } };
}

export interface DesignMass extends MassProps {
  chassis: MassProps;
  parts: { instanceId: string; massG: number; cog: Vec3 }[];
}

/** Whole-robot mass and centre of gravity. A part's own CoG is taken as the centre of its box. */
export function designMassProps(design: Design, chassis: Chassis, lookup: Lookup): DesignMass {
  const plate = chassisMassProps(chassis);
  const parts = design.placements.flatMap((p) => {
    const c = lookup(p.componentId);
    if (!c) return [];
    return [
      {
        instanceId: p.instanceId,
        massG: c.massG,
        cog: { x: p.position.x, y: p.position.y, z: p.position.z + c.dimensionsMm.z / 2 },
      },
    ];
  });
  let m = plate.massG;
  let x = plate.massG * plate.cog.x;
  let y = plate.massG * plate.cog.y;
  let z = plate.massG * plate.cog.z;
  for (const p of parts) {
    m += p.massG;
    x += p.massG * p.cog.x;
    y += p.massG * p.cog.y;
    z += p.massG * p.cog.z;
  }
  return {
    massG: m,
    cog: m > 0 ? { x: x / m, y: y / m, z: z / m } : { x: 0, y: 0, z: 0 },
    chassis: plate,
    parts,
  };
}
