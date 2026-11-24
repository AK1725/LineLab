import type {
  Chassis,
  Component,
  Design,
  Net,
  PhotoDetection,
  Placement,
  Vec2,
} from "@linelab/schema";
import {
  autoWire,
  bounds,
  centroid,
  defaultPlacement,
  ensureCCW,
  footprint,
  footprintCorners,
  footprintsOverlap,
  makeCustomChassis,
  newDesign,
  pointInPolygon,
  quatFromYaw,
  type Lookup,
} from "@linelab/design-core";

export type Front = "up" | "down" | "left" | "right";

export interface TopPhoto {
  widthPx: number;
  heightPx: number;
  /** Robot silhouette in the top photo, as fractions of the image (from apps/vision). */
  outline?: Vec2[];
}

export interface Pick {
  detectionId: string;
  componentId: string;
  count: number;
}

export interface ProposalInput {
  id: string;
  name: string;
  detections: readonly PhotoDetection[];
  picks: readonly Pick[];
  top?: TopPhoto;
  frontInTop: Front;
  /** "photo": a custom chassis from the silhouette; or a template; default photo when possible. */
  chassis?: { kind: "photo" } | { kind: "template"; chassisId: string };
  lookup: Lookup;
  getChassis: (id: string) => Chassis | undefined;
  templates: readonly Chassis[];
}

export interface Proposal {
  design: Design;
  /** Nets to confirm one by one (from auto-wiring the detected combination). */
  proposedNets: Net[];
  /** mm per pixel of the top photo, if it could be estimated. */
  scaleMmPerPx: number | undefined;
  chassisSource: "photo" | "template";
  notes: string[];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length === 0 ? undefined : s.length % 2 ? s[m] : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};

/** Unit vectors (in photo pixels) of the robot's forward (+x) and left (+y) axes. */
function axes(front: Front): { fwd: Vec2; left: Vec2 } {
  switch (front) {
    case "up":
      return { fwd: { x: 0, y: -1 }, left: { x: -1, y: 0 } };
    case "down":
      return { fwd: { x: 0, y: 1 }, left: { x: 1, y: 0 } };
    case "right":
      return { fwd: { x: 1, y: 0 }, left: { x: 0, y: -1 } };
    case "left":
      return { fwd: { x: -1, y: 0 }, left: { x: 0, y: 1 } };
  }
}

interface Seen {
  /** Centre in photo pixels. */
  c: Vec2;
  /** Extent along the robot's forward and left axes (px). */
  alongX: number;
  alongY: number;
}

function seen(d: PhotoDetection, top: TopPhoto, front: Front): Seen | undefined {
  const b = d.topBox;
  if (!b || b.w <= 0 || b.h <= 0) return undefined;
  const w = b.w * top.widthPx;
  const h = b.h * top.heightPx;
  const vertical = front === "up" || front === "down";
  return {
    c: { x: (b.x + b.w / 2) * top.widthPx, y: (b.y + b.h / 2) * top.heightPx },
    alongX: vertical ? h : w,
    alongY: vertical ? w : h,
  };
}

/**
 * Scale (mm per pixel) of the top photo from parts of known size: each matched part with a box
 * gives two estimates (long side vs long side, short vs short); the median is robust to a bad box.
 */
export function estimateScale(
  detections: readonly PhotoDetection[],
  picks: readonly Pick[],
  top: TopPhoto,
  front: Front,
  lookup: Lookup,
): number | undefined {
  const est: number[] = [];
  for (const p of picks) {
    const d = detections.find((x) => x.id === p.detectionId);
    const c = lookup(p.componentId);
    if (!d || !c || p.count !== 1 || c.category === "caster") continue;
    const s = seen(d, top, front);
    if (!s) continue;
    const [bigPx, smallPx] = [Math.max(s.alongX, s.alongY), Math.min(s.alongX, s.alongY)];
    const [bigMm, smallMm] = [
      Math.max(c.dimensionsMm.x, c.dimensionsMm.y),
      Math.min(c.dimensionsMm.x, c.dimensionsMm.y),
    ];
    if (bigPx > 4) est.push(bigMm / bigPx);
    if (smallPx > 4) est.push(smallMm / smallPx);
  }
  // Wheels come in pairs: their size still gives scale.
  for (const p of picks) {
    const d = detections.find((x) => x.id === p.detectionId);
    const c = lookup(p.componentId);
    if (!d || !c || c.category !== "wheel" || p.count === 1) continue;
    const s = seen(d, top, front);
    // A box around both wheels spans the track; use its forward extent (= diameter).
    if (s && s.alongX > 4) est.push(Math.max(c.dimensionsMm.x, c.dimensionsMm.z) / s.alongX);
  }
  return median(est);
}

/** Clip a polygon to |y| ≤ half (Sutherland–Hodgman against two half-planes). */
function clipToBand(poly: Vec2[], half: number): Vec2[] {
  const clip = (pts: Vec2[], sign: 1 | -1) => {
    const inside = (p: Vec2) => sign * p.y <= half;
    const out: Vec2[] = [];
    pts.forEach((cur, i) => {
      const prev = pts[(i + pts.length - 1) % pts.length] ?? cur;
      const cross = (): Vec2 => {
        const t = (sign * half - prev.y) / (cur.y - prev.y);
        return { x: prev.x + t * (cur.x - prev.x), y: sign * half };
      };
      if (inside(cur)) {
        if (!inside(prev)) out.push(cross());
        out.push(cur);
      } else if (inside(prev)) out.push(cross());
    });
    return out;
  };
  return clip(clip(poly, 1), -1);
}

const ORDER: Component["category"][] = ["wheel", "motor", "caster", "line_sensor"];
const rank = (c: Component) => {
  const i = ORDER.indexOf(c.category);
  return i < 0 ? ORDER.length : i;
};
/** Parts LineLab mounts by rule (wheel mounts, axle, nose); the rest go where the photo shows. */
const MOUNTED = new Set<Component["category"]>(["wheel", "motor", "caster", "line_sensor"]);

/**
 * Turn confirmed detections into a design (BLUEPRINT §5.10 steps 4–6): scale from parts of known
 * size, a chassis from the top-view silhouette (or a template), parts placed where the top photo
 * shows them (wheels, motors, caster and sensors on their mounts), and a proposed netlist that
 * the user confirms net by net. Nothing here is final: every position can be dragged afterwards.
 */
export function proposeDesign(input: ProposalInput): Proposal {
  const { lookup, top, frontInTop } = input;
  const notes: string[] = [];
  const parts = input.picks.flatMap((p) => {
    const c = lookup(p.componentId);
    const d = input.detections.find((x) => x.id === p.detectionId);
    return c && d ? [{ p, c, d }] : [];
  });
  const scale = top
    ? estimateScale(input.detections, input.picks, top, frontInTop, lookup)
    : undefined;
  const { fwd, left } = axes(frontInTop);

  // Robot origin = drive-axle midpoint: from the wheels in the top photo, else the silhouette.
  const wheel = parts.find((x) => x.c.category === "wheel");
  const wheelSeen = wheel && top ? seen(wheel.d, top, frontInTop) : undefined;
  const outlinePx = top?.outline?.map((q) => ({ x: q.x * top.widthPx, y: q.y * top.heightPx }));
  let origin: Vec2 | undefined;
  if (wheelSeen) origin = wheelSeen.c;
  else if (outlinePx && outlinePx.length >= 3) origin = centroid(outlinePx);
  const toMm = (q: Vec2): Vec2 | undefined =>
    origin && scale
      ? {
          x: ((q.x - origin.x) * fwd.x + (q.y - origin.y) * fwd.y) * scale,
          y: ((q.x - origin.x) * left.x + (q.y - origin.y) * left.y) * scale,
        }
      : undefined;

  // Chassis.
  let chassis: Chassis | undefined;
  let chassisSource: Proposal["chassisSource"] = "template";
  const wantPhoto = input.chassis?.kind !== "template";
  if (wantPhoto && outlinePx && outlinePx.length >= 3 && scale && origin) {
    let outline = ensureCCW(outlinePx.map((q) => toMm(q) ?? { x: 0, y: 0 }));
    const wc = wheel?.c;
    const wheelW = wc ? Math.min(wc.dimensionsMm.x, wc.dimensionsMm.y, wc.dimensionsMm.z) : 20;
    const wheelD = wc ? Math.max(wc.dimensionsMm.x, wc.dimensionsMm.z) : 43;
    const ob = bounds(outline);
    // A silhouette includes the wheels: the plate stops inside them.
    const silhouetteHalf = Math.max(ob.maxY, -ob.minY);
    const trackHalf =
      wheelSeen && wheel && wheel.p.count >= 2 && wheelSeen.alongY * scale > wheelW * 2
        ? (wheelSeen.alongY * scale - wheelW) / 2
        : silhouetteHalf - wheelW / 2;
    outline = ensureCCW(clipToBand(outline, trackHalf - wheelW / 2 - 1.5));
    const motor = parts.find((x) => x.c.category === "motor")?.c;
    const axle = wheelD / 2;
    const thickness = 3;
    const b = bounds(outline);
    const casterC = parts.find((x) => x.c.category === "caster")?.c;
    const sensorC = parts.find((x) => x.c.category === "line_sensor")?.c;
    chassis = makeCustomChassis({
      id: `chassis.photo-${input.id}`,
      name: "From photo",
      outline,
      thicknessMm: thickness,
      material: "acrylic",
      deckHeightMm:
        Math.round((axle + (motor ? motor.dimensionsMm.z / 2 : 6) + thickness + 0.5) * 10) / 10,
      trackHalfMm: Math.round(trackHalf * 10) / 10,
      axleHeightMm: axle,
      casterMounts: casterC ? [casterMount(b, casterC, sensorC)] : [],
      holePitchMm: 10,
    });
    chassisSource = "photo";
    notes.push(
      `Chassis from the top-photo silhouette: ${Math.round(b.maxX - b.minX)} × ${Math.round(b.maxY - b.minY)} mm, wheel track ${Math.round(trackHalf * 2)} mm.`,
    );
  } else {
    const wanted =
      input.chassis?.kind === "template" ? input.getChassis(input.chassis.chassisId) : undefined;
    chassis = wanted ?? nearestTemplate(input.templates, parts, outlinePx, scale);
    if (!chassis) throw new Error("No chassis template available.");
    notes.push(
      wanted
        ? `Using the ${chassis.name} chassis you chose.`
        : `No usable silhouette or scale, so the closest template (${chassis.name}) is used. Pick another or draw your own in the editor.`,
    );
  }
  if (scale) notes.push(`Scale from known part sizes: ${scale.toFixed(3)} mm per pixel.`);
  else notes.push("Scale unknown (no part outlined in the top photo): parts go to default spots.");

  let design = newDesign(
    input.id,
    input.name,
    chassisSource === "photo"
      ? { kind: "custom", chassis }
      : { kind: "template", chassisId: chassis.id },
  );
  const sorted = [...parts].sort((a, b) => rank(a.c) - rank(b.c));
  for (const { p, c, d } of sorted) {
    for (let k = 0; k < p.count; k++) {
      let pl = defaultPlacement(c, design, chassis, lookup);
      const s = top ? seen(d, top, frontInTop) : undefined;
      const at = s ? toMm(s.c) : undefined;
      if (!MOUNTED.has(c.category) && p.count === 1 && at && scale && s) {
        // Lengthwise along the robot or across it, whichever matches the box.
        const boxAlongX = s.alongX >= s.alongY;
        const partAlongX = c.dimensionsMm.x >= c.dimensionsMm.y;
        const yaw = boxAlongX === partAlongX ? 0 : Math.PI / 2;
        const moved: Placement = {
          ...pl,
          position: { ...pl.position, x: Math.round(at.x), y: Math.round(at.y) },
          rotation: quatFromYaw(yaw),
        };
        if (fits(moved, c, design, chassis, lookup)) pl = moved;
        else
          notes.push(
            `${c.name}: the photo position collides or overhangs, so it went to a free spot.`,
          );
      }
      design = { ...design, placements: [...design.placements, pl] };
    }
  }
  return {
    design,
    proposedNets: autoWire(design, lookup),
    scaleMmPerPx: scale,
    chassisSource,
    notes,
  };
}

/** Caster on the long end of the plate, behind the line sensor if that end is the nose. */
function casterMount(
  b: { minX: number; maxX: number },
  caster: Component,
  sensor: Component | undefined,
): Vec2 {
  const r = Math.max(caster.dimensionsMm.x, caster.dimensionsMm.y) / 2;
  if (b.maxX > -b.minX)
    return { x: Math.round(b.maxX - (sensor ? sensor.dimensionsMm.x + 2 : 0) - r - 3), y: 0 };
  return { x: Math.round(b.minX + r + 3), y: 0 };
}

function fits(
  pl: Placement,
  c: Component,
  design: Design,
  chassis: Chassis,
  lookup: Lookup,
): boolean {
  const f = footprint(pl, c);
  if (!footprintCorners(f).every((q) => pointInPolygon(q, chassis.outline))) return false;
  return design.placements.every((o) => {
    const oc = lookup(o.componentId);
    return (
      !oc || o.deck !== pl.deck || o.mount !== pl.mount || !footprintsOverlap(f, footprint(o, oc))
    );
  });
}

/** The template closest in size to the photo (or, without scale, the one matching the wheel size). */
function nearestTemplate(
  templates: readonly Chassis[],
  parts: { c: Component; p: Pick }[],
  outlinePx: Vec2[] | undefined,
  scale: number | undefined,
): Chassis | undefined {
  const wheel = parts.find((x) => x.c.category === "wheel")?.c;
  const wheelCount = parts
    .filter((x) => x.c.category === "wheel")
    .reduce((n, x) => n + x.p.count, 0);
  const wheelR = wheel ? Math.max(wheel.dimensionsMm.x, wheel.dimensionsMm.z) / 2 : undefined;
  const size = outlinePx ? bounds(outlinePx) : undefined;
  const lengthMm =
    size && scale ? Math.max(size.maxX - size.minX, size.maxY - size.minY) * scale : undefined;
  let best: { c: Chassis; cost: number } | undefined;
  for (const c of templates) {
    const b = bounds(c.outline);
    let cost = 0;
    if (lengthMm) cost += Math.abs(b.maxX - b.minX - lengthMm) / 10;
    if (wheelR) cost += Math.abs((c.wheelMounts[0]?.axleHeightMm ?? 0) - wheelR);
    if (wheelCount) cost += Math.abs(c.wheelMounts.length - wheelCount) * 5;
    if (!best || cost < best.cost) best = { c, cost };
  }
  return best?.c;
}
