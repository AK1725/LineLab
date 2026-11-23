import type { Chassis, Polygon, Vec2 } from "@linelab/schema";
import { MATERIAL_DENSITY_GCM3 } from "./mass.js";
import {
  bounds,
  distanceToEdges,
  ensureCCW,
  pointInPolygon,
  round2,
  roundCorners,
} from "./polygon.js";

export type OutlinePreset = "rectangle" | "t-nose" | "octagon";

export interface OutlineParams {
  preset: OutlinePreset;
  /** Body length along X (mm). */
  lengthMm: number;
  /** Body width along Y (mm). */
  widthMm: number;
  /** How far the body extends behind the drive axle (mm). */
  rearOverhangMm: number;
  /** T-nose only: neck length ahead of the body, its width, and the sensor bar size. */
  noseLengthMm?: number;
  noseWidthMm?: number;
  barWidthMm?: number;
  barDepthMm?: number;
  cornerRadiusMm?: number;
}

/** Builds a counter-clockwise outline in the chassis frame (drive axle at x = 0). */
export function buildOutline(p: OutlineParams): Polygon {
  const x0 = -p.rearOverhangMm;
  const x1 = x0 + p.lengthMm;
  const hw = p.widthMm / 2;
  let poly: Vec2[];
  if (p.preset === "rectangle") {
    poly = [
      { x: x0, y: -hw },
      { x: x1, y: -hw },
      { x: x1, y: hw },
      { x: x0, y: hw },
    ];
  } else if (p.preset === "octagon") {
    const cx = (x0 + x1) / 2;
    const rx = p.lengthMm / 2;
    const ry = hw;
    poly = Array.from({ length: 8 }, (_, i) => {
      const a = (Math.PI / 8) * (2 * i + 1);
      return { x: round2(cx + rx * Math.cos(a)), y: round2(ry * Math.sin(a)) };
    });
  } else {
    const neck = (p.noseWidthMm ?? 20) / 2;
    const nose = p.noseLengthMm ?? 80;
    const bar = (p.barWidthMm ?? p.widthMm) / 2;
    const depth = p.barDepthMm ?? 15;
    const xb = x1 + nose;
    poly = [
      { x: x0, y: -hw },
      { x: x1, y: -hw },
      { x: x1, y: -neck },
      { x: xb, y: -neck },
      { x: xb, y: -bar },
      { x: xb + depth, y: -bar },
      { x: xb + depth, y: bar },
      { x: xb, y: bar },
      { x: xb, y: neck },
      { x: x1, y: neck },
      { x: x1, y: hw },
      { x: x0, y: hw },
    ];
  }
  const r = p.cornerRadiusMm ?? 0;
  return ensureCCW(r > 0 ? roundCorners(poly, r) : poly);
}

/** A grid of mounting holes inside the outline, keeping `marginMm` from every edge and cutout. */
export function holeGrid(
  outline: readonly Vec2[],
  pitchMm: number,
  marginMm = 5,
  cutouts: readonly Polygon[] = [],
): Vec2[] {
  if (pitchMm <= 0) return [];
  const b = bounds(outline);
  const pts: Vec2[] = [];
  for (let x = Math.ceil(b.minX / pitchMm) * pitchMm; x <= b.maxX; x += pitchMm) {
    for (let y = Math.ceil(b.minY / pitchMm) * pitchMm; y <= b.maxY; y += pitchMm) {
      const p = { x: round2(x), y: round2(y) };
      if (!pointInPolygon(p, outline) || distanceToEdges(p, outline) < marginMm) continue;
      if (cutouts.some((c) => pointInPolygon(p, c) || distanceToEdges(p, c) < marginMm)) continue;
      pts.push(p);
    }
  }
  return pts;
}

export interface CustomChassisParams {
  id: string;
  name: string;
  outline: Polygon;
  cutouts?: Polygon[];
  thicknessMm: number;
  material: Chassis["material"];
  densityGcm3?: number;
  /** Top of the deck above the ground (mm). */
  deckHeightMm: number;
  /** Wheel contact points at ±trackHalfMm (Y) on the axle line x = 0. */
  trackHalfMm: number;
  axleHeightMm: number;
  casterMounts: Vec2[];
  holePitchMm: number;
  /** Use these hole positions (e.g. from an imported DXF) instead of a generated grid. */
  mountPoints?: Vec2[];
  mountHoleDiameterMm?: number;
}

export function makeCustomChassis(p: CustomChassisParams): Chassis {
  const outline = ensureCCW(p.outline);
  const cutouts = (p.cutouts ?? []).map(ensureCCW);
  const chassis: Chassis = {
    id: p.id,
    name: p.name,
    outline,
    thicknessMm: p.thicknessMm,
    material: p.material,
    densityGcm3: p.densityGcm3 ?? MATERIAL_DENSITY_GCM3[p.material],
    decks: [{ index: 0, heightMm: p.deckHeightMm }],
    mountPoints: p.mountPoints ?? holeGrid(outline, p.holePitchMm, 5, cutouts),
    mountHoleDiameterMm: p.mountHoleDiameterMm ?? 3.2,
    wheelMounts: [
      { side: "left", position: { x: 0, y: p.trackHalfMm }, axleHeightMm: p.axleHeightMm },
      { side: "right", position: { x: 0, y: -p.trackHalfMm }, axleHeightMm: p.axleHeightMm },
    ],
    casterMounts: p.casterMounts,
  };
  if (cutouts.length > 0) chassis.cutouts = cutouts;
  return chassis;
}
