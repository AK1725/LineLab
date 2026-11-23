import type { Chassis, Polygon, Vec2 } from "@linelab/schema";
import { DEFAULT_HOLE_DIAMETER_MM } from "../mass.js";
import { area, circlePolygon, pointInPolygon, round2 } from "../polygon.js";

const fmt = (n: number) => Number(n.toFixed(4)).toString();

/**
 * DXF R12 (AC1009) of the deck-0 plate, in millimetres: outline and cutouts as closed polylines on
 * layers OUTLINE / CUTOUT, mounting holes as circles on layer HOLES. R12 opens in every laser-cutter
 * and CAD tool.
 */
export function chassisToDxf(chassis: Chassis): string {
  const out: string[] = [];
  const g = (code: number, value: string | number) =>
    out.push(String(code), typeof value === "number" ? fmt(value) : value);
  const poly = (pts: readonly Vec2[], layer: string) => {
    g(0, "POLYLINE");
    g(8, layer);
    g(66, "1");
    g(70, "1"); // closed
    for (const p of pts) {
      g(0, "VERTEX");
      g(8, layer);
      g(10, p.x);
      g(20, p.y);
      g(30, 0);
    }
    g(0, "SEQEND");
    g(8, layer);
  };
  g(0, "SECTION");
  g(2, "HEADER");
  g(9, "$ACADVER");
  g(1, "AC1009");
  g(9, "$INSUNITS");
  g(70, "4"); // millimetres
  g(0, "ENDSEC");
  g(0, "SECTION");
  g(2, "ENTITIES");
  poly(chassis.outline, "OUTLINE");
  for (const c of chassis.cutouts ?? []) poly(c, "CUTOUT");
  const r = (chassis.mountHoleDiameterMm ?? DEFAULT_HOLE_DIAMETER_MM) / 2;
  for (const h of chassis.mountPoints) {
    g(0, "CIRCLE");
    g(8, "HOLES");
    g(10, h.x);
    g(20, h.y);
    g(30, 0);
    g(40, r);
  }
  g(0, "ENDSEC");
  g(0, "EOF");
  return `${out.join("\n")}\n`;
}

export interface ImportedOutline {
  outline: Polygon;
  cutouts: Polygon[];
  /** Small circles (≤ 6 mm) become mounting holes. */
  holes: Vec2[];
  holeDiameterMm?: number;
  warnings: string[];
}

/** Splits loops into the largest (outline), loops inside it (cutouts) and the rest (ignored). */
export function classifyLoops(
  loops: Polygon[],
  holes: Vec2[],
  holeDiameterMm: number | undefined,
  warnings: string[],
): ImportedOutline {
  const closed = loops.filter((l) => l.length >= 3 && area(l) > 1);
  if (closed.length === 0)
    throw new Error("No closed outline found. Draw the chassis as one closed shape.");
  closed.sort((a, b) => area(b) - area(a));
  const outline = closed[0] as Polygon;
  const cutouts: Polygon[] = [];
  for (const l of closed.slice(1)) {
    const first = l[0];
    if (first && pointInPolygon(first, outline)) cutouts.push(l);
    else warnings.push("Ignored a closed shape outside the main outline.");
  }
  const out: ImportedOutline = {
    outline,
    cutouts,
    holes: holes.filter((h) => pointInPolygon(h, outline)),
    warnings,
  };
  if (holeDiameterMm !== undefined) out.holeDiameterMm = holeDiameterMm;
  return out;
}

/** Points along a bulged LWPOLYLINE segment (bulge = tan(θ/4)). */
function bulgePoints(a: Vec2, b: Vec2, bulge: number, segments = 8): Vec2[] {
  if (Math.abs(bulge) < 1e-9) return [];
  const theta = 4 * Math.atan(bulge);
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  const r = chord / (2 * Math.sin(theta / 2));
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const h = r * Math.cos(theta / 2);
  const nx = -(b.y - a.y) / chord;
  const ny = (b.x - a.x) / chord;
  const c = { x: mid.x + nx * h, y: mid.y + ny * h };
  const a0 = Math.atan2(a.y - c.y, a.x - c.x);
  const pts: Vec2[] = [];
  for (let i = 1; i < segments; i++) {
    const t = a0 + (theta * i) / segments;
    pts.push({
      x: round2(c.x + Math.abs(r) * Math.cos(t)),
      y: round2(c.y + Math.abs(r) * Math.sin(t)),
    });
  }
  return pts;
}

/** Joins loose segments end-to-end into closed loops. */
function chainSegments(segments: [Vec2, Vec2][], tol = 0.05): Polygon[] {
  const loops: Polygon[] = [];
  const rest = [...segments];
  const same = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.y - q.y) <= tol;
  while (rest.length > 0) {
    const first = rest.shift() as [Vec2, Vec2];
    const loop: Vec2[] = [first[0], first[1]];
    let grew = true;
    while (grew && !same(loop[0] as Vec2, loop.at(-1) as Vec2)) {
      grew = false;
      const end = loop.at(-1) as Vec2;
      const i = rest.findIndex(([p, q]) => same(p, end) || same(q, end));
      if (i >= 0) {
        const [p, q] = rest.splice(i, 1)[0] as [Vec2, Vec2];
        loop.push(same(p, end) ? q : p);
        grew = true;
      }
    }
    if (same(loop[0] as Vec2, loop.at(-1) as Vec2)) loops.push(loop.slice(0, -1));
  }
  return loops;
}

/** Reads LWPOLYLINE (with bulges), POLYLINE, LINE, ARC and CIRCLE entities from an ASCII DXF. */
export function parseDxfOutline(text: string): ImportedOutline {
  const lines = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt((lines[i] ?? "").trim(), 10);
    if (Number.isNaN(code)) continue;
    pairs.push([code, (lines[i + 1] ?? "").trim()]);
  }
  const loops: Polygon[] = [];
  const segments: [Vec2, Vec2][] = [];
  const holes: Vec2[] = [];
  const warnings: string[] = [];
  let holeD: number | undefined;

  let i = 0;
  const entity = () => {
    const start = i;
    i++;
    while (i < pairs.length && pairs[i]?.[0] !== 0) i++;
    return pairs.slice(start + 1, i);
  };
  const num = (data: [number, string][], code: number) =>
    Number(data.find(([c]) => c === code)?.[1] ?? "0");

  while (i < pairs.length) {
    const [code, value] = pairs[i] as [number, string];
    if (code !== 0) {
      i++;
      continue;
    }
    if (value === "LWPOLYLINE") {
      const data = entity();
      const pts: Vec2[] = [];
      const bulges: number[] = [];
      for (const [c, v] of data) {
        if (c === 10) {
          pts.push({ x: Number(v), y: 0 });
          bulges.push(0);
        } else if (c === 20 && pts.length > 0) (pts.at(-1) as Vec2).y = Number(v);
        else if (c === 42 && bulges.length > 0) bulges[bulges.length - 1] = Number(v);
      }
      const closed = (num(data, 70) & 1) === 1;
      const out: Vec2[] = [];
      for (let k = 0; k < pts.length; k++) {
        const a = pts[k] as Vec2;
        out.push(a);
        const b = pts[(k + 1) % pts.length] as Vec2;
        if (k < pts.length - 1 || closed) out.push(...bulgePoints(a, b, bulges[k] ?? 0));
      }
      if (closed) loops.push(out);
      else
        for (let k = 0; k + 1 < out.length; k++)
          segments.push([out[k] as Vec2, out[k + 1] as Vec2]);
    } else if (value === "POLYLINE") {
      const head = entity();
      const pts: Vec2[] = [];
      while (i < pairs.length && pairs[i]?.[1] === "VERTEX") {
        const v = entity();
        pts.push({ x: num(v, 10), y: num(v, 20) });
      }
      if (pairs[i]?.[1] === "SEQEND") entity();
      if ((num(head, 70) & 1) === 1) loops.push(pts);
      else
        for (let k = 0; k + 1 < pts.length; k++)
          segments.push([pts[k] as Vec2, pts[k + 1] as Vec2]);
    } else if (value === "LINE") {
      const d = entity();
      segments.push([
        { x: num(d, 10), y: num(d, 20) },
        { x: num(d, 11), y: num(d, 21) },
      ]);
    } else if (value === "ARC") {
      const d = entity();
      const c = { x: num(d, 10), y: num(d, 20) };
      const r = num(d, 40);
      const a0 = (num(d, 50) * Math.PI) / 180;
      let a1 = (num(d, 51) * Math.PI) / 180;
      if (a1 <= a0) a1 += 2 * Math.PI;
      const n = Math.max(2, Math.ceil(((a1 - a0) / (Math.PI / 2)) * 6));
      for (let k = 0; k < n; k++) {
        const t0 = a0 + ((a1 - a0) * k) / n;
        const t1 = a0 + ((a1 - a0) * (k + 1)) / n;
        segments.push([
          { x: round2(c.x + r * Math.cos(t0)), y: round2(c.y + r * Math.sin(t0)) },
          { x: round2(c.x + r * Math.cos(t1)), y: round2(c.y + r * Math.sin(t1)) },
        ]);
      }
    } else if (value === "CIRCLE") {
      const d = entity();
      const c = { x: num(d, 10), y: num(d, 20) };
      const r = num(d, 40);
      if (r * 2 <= 6) {
        holes.push(c);
        holeD = round2(r * 2);
      } else loops.push(circlePolygon(c, r, 32));
    } else {
      entity();
    }
  }
  loops.push(...chainSegments(segments));
  return classifyLoops(loops, holes, holeD, warnings);
}
