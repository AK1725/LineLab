import type { Polygon, Vec2 } from "@linelab/schema";

/** Signed area (mm²): positive for counter-clockwise polygons. */
export function signedArea(poly: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    if (p === undefined || q === undefined) continue;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export const area = (poly: readonly Vec2[]): number => Math.abs(signedArea(poly));

/** Area centroid of a simple polygon. */
export function centroid(poly: readonly Vec2[]): Vec2 {
  const a = signedArea(poly);
  if (Math.abs(a) < 1e-9) {
    const n = Math.max(1, poly.length);
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    if (p === undefined || q === undefined) continue;
    const cross = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export const ensureCCW = (poly: readonly Vec2[]): Vec2[] =>
  signedArea(poly) < 0 ? [...poly].reverse() : [...poly];

export function bounds(poly: readonly Vec2[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Even-odd point-in-polygon test. Points exactly on an edge may go either way. */
export function pointInPolygon(pt: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a === undefined || b === undefined) continue;
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Distance from a point to the closest edge of a polygon. */
export function distanceToEdges(pt: Vec2, poly: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (a === undefined || b === undefined) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t =
      len2 === 0 ? 0 : Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2));
    best = Math.min(best, Math.hypot(pt.x - a.x - t * dx, pt.y - a.y - t * dy));
  }
  return best;
}

/** Proper intersection of segments ab and cd (touching endpoints count as intersecting). */
export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const o1 = o(a, b, c);
  const o2 = o(a, b, d);
  const o3 = o(c, d, a);
  const o4 = o(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  const on = (p: Vec2, q: Vec2, r: Vec2) =>
    Math.min(p.x, q.x) <= r.x &&
    r.x <= Math.max(p.x, q.x) &&
    Math.min(p.y, q.y) <= r.y &&
    r.y <= Math.max(p.y, q.y);
  return (
    (o1 === 0 && on(a, b, c)) ||
    (o2 === 0 && on(a, b, d)) ||
    (o3 === 0 && on(c, d, a)) ||
    (o4 === 0 && on(c, d, b))
  );
}

/** True if two polygons overlap (share interior or cross edges). */
export function polygonsOverlap(p: readonly Vec2[], q: readonly Vec2[]): boolean {
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    if (a === undefined || b === undefined) continue;
    for (let j = 0; j < q.length; j++) {
      const c = q[j];
      const d = q[(j + 1) % q.length];
      if (c === undefined || d === undefined) continue;
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  const p0 = p[0];
  const q0 = q[0];
  return (p0 !== undefined && pointInPolygon(p0, q)) || (q0 !== undefined && pointInPolygon(q0, p));
}

/** Convex hull (Andrew's monotone chain), counter-clockwise. */
export function convexHull(points: readonly Vec2[]): Vec2[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower.at(-2) as Vec2, lower.at(-1) as Vec2, p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2) as Vec2, upper.at(-1) as Vec2, p) <= 0)
      upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Replace every corner with an arc of the given radius (clamped so arcs never overlap). */
export function roundCorners(poly: readonly Vec2[], radiusMm: number, segments = 6): Polygon {
  if (radiusMm <= 0 || poly.length < 3) return [...poly];
  const out: Vec2[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n] as Vec2;
    const cur = poly[i] as Vec2;
    const next = poly[(i + 1) % n] as Vec2;
    const v1 = { x: prev.x - cur.x, y: prev.y - cur.y };
    const v2 = { x: next.x - cur.x, y: next.y - cur.y };
    const l1 = Math.hypot(v1.x, v1.y);
    const l2 = Math.hypot(v2.x, v2.y);
    const angle = Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (l1 * l2))));
    const tanHalf = Math.tan(angle / 2);
    if (tanHalf < 1e-6 || angle > Math.PI - 1e-3) {
      out.push(cur);
      continue;
    }
    const dist = Math.min(radiusMm / tanHalf, l1 / 2, l2 / 2);
    const r = dist * tanHalf;
    const a = { x: cur.x + (v1.x / l1) * dist, y: cur.y + (v1.y / l1) * dist };
    const b = { x: cur.x + (v2.x / l2) * dist, y: cur.y + (v2.y / l2) * dist };
    const bis = { x: v1.x / l1 + v2.x / l2, y: v1.y / l1 + v2.y / l2 };
    const bl = Math.hypot(bis.x, bis.y);
    const c = {
      x: cur.x + (bis.x / bl) * Math.hypot(dist, r),
      y: cur.y + (bis.y / bl) * Math.hypot(dist, r),
    };
    const a0 = Math.atan2(a.y - c.y, a.x - c.x);
    let a1 = Math.atan2(b.y - c.y, b.x - c.x);
    // Sweep the short way round.
    let sweep = a1 - a0;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    a1 = a0 + sweep;
    for (let s = 0; s <= segments; s++) {
      const t = a0 + ((a1 - a0) * s) / segments;
      out.push({ x: round2(c.x + r * Math.cos(t)), y: round2(c.y + r * Math.sin(t)) });
    }
  }
  return out;
}

export const round2 = (v: number) => Math.round(v * 100) / 100;

/** Regular polygon approximating a circle (counter-clockwise). */
export function circlePolygon(center: Vec2, radius: number, segments = 24): Polygon {
  return Array.from({ length: segments }, (_, i) => {
    const a = (2 * Math.PI * i) / segments;
    return {
      x: round2(center.x + radius * Math.cos(a)),
      y: round2(center.y + radius * Math.sin(a)),
    };
  });
}
