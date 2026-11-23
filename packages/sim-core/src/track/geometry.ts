import type { Track, TrackSegment, Vec2 } from "@linelab/schema";

/** One sample along the track centreline. */
export interface PathSample {
  x: number;
  y: number;
  /** Arc length from the start of the segment list (mm). */
  s: number;
  /** Unit tangent. */
  tx: number;
  ty: number;
  /** Index of the segment this sample belongs to. */
  seg: number;
}

/** A polyline approximation of the centreline with cumulative arc length. */
export interface SampledPath {
  samples: PathSample[];
  length: number;
}

const DEFAULT_STEP_MM = 1;

function bezierPoint(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/** Points along one segment, roughly `step` mm apart, including both ends. */
export function segmentPoints(seg: TrackSegment, step = DEFAULT_STEP_MM): Vec2[] {
  switch (seg.type) {
    case "line": {
      const len = Math.hypot(seg.to.x - seg.from.x, seg.to.y - seg.from.y);
      const n = Math.max(1, Math.ceil(len / step));
      return Array.from({ length: n + 1 }, (_, i) => ({
        x: seg.from.x + ((seg.to.x - seg.from.x) * i) / n,
        y: seg.from.y + ((seg.to.y - seg.from.y) * i) / n,
      }));
    }
    case "arc": {
      const len = Math.abs(seg.sweepRad) * seg.radiusMm;
      const n = Math.max(2, Math.ceil(len / step));
      return Array.from({ length: n + 1 }, (_, i) => {
        const a = seg.startAngleRad + (seg.sweepRad * i) / n;
        return {
          x: seg.center.x + seg.radiusMm * Math.cos(a),
          y: seg.center.y + seg.radiusMm * Math.sin(a),
        };
      });
    }
    case "bezier": {
      // Dense parameter sampling, then resample by arc length.
      const dense = Array.from({ length: 201 }, (_, i) =>
        bezierPoint(seg.p0, seg.p1, seg.p2, seg.p3, i / 200),
      );
      const cum = [0];
      for (let i = 1; i < dense.length; i++) {
        const a = dense[i - 1] as Vec2;
        const b = dense[i] as Vec2;
        cum.push((cum[i - 1] ?? 0) + Math.hypot(b.x - a.x, b.y - a.y));
      }
      const len = cum.at(-1) ?? 0;
      const n = Math.max(2, Math.ceil(len / step));
      const out: Vec2[] = [];
      let j = 0;
      for (let i = 0; i <= n; i++) {
        const target = (len * i) / n;
        while (j < cum.length - 2 && (cum[j + 1] ?? 0) < target) j++;
        const s0 = cum[j] ?? 0;
        const s1 = cum[j + 1] ?? s0;
        const f = s1 > s0 ? (target - s0) / (s1 - s0) : 0;
        const a = dense[j] as Vec2;
        const b = dense[j + 1] ?? a;
        out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
      }
      return out;
    }
  }
}

/** Samples every segment in order and accumulates arc length. */
export function sampleTrack(track: Pick<Track, "segments">, step = DEFAULT_STEP_MM): SampledPath {
  const samples: PathSample[] = [];
  let s = 0;
  track.segments.forEach((seg, segIndex) => {
    const pts = segmentPoints(seg, step);
    pts.forEach((p, i) => {
      const prev = samples.at(-1);
      if (prev) {
        const d = Math.hypot(p.x - prev.x, p.y - prev.y);
        if (i === 0 && d < 1e-6) return; // shared endpoint with the previous segment
        s += d;
      }
      samples.push({ x: p.x, y: p.y, s, tx: 0, ty: 0, seg: segIndex });
    });
  });
  for (let i = 0; i < samples.length; i++) {
    const a = samples[Math.max(0, i - 1)] as PathSample;
    const b = samples[Math.min(samples.length - 1, i + 1)] as PathSample;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    const cur = samples[i] as PathSample;
    cur.tx = dx / l;
    cur.ty = dy / l;
  }
  return { samples, length: s };
}

export const trackLength = (track: Pick<Track, "segments">) => sampleTrack(track).length;

export interface ClosestPoint {
  /** Arc length of the closest centreline point. */
  s: number;
  x: number;
  y: number;
  /** Unsigned distance from the query point to the centreline (mm). */
  distance: number;
  /** Signed lateral offset: positive when the point is left of the direction of travel. */
  lateral: number;
  tx: number;
  ty: number;
}

/**
 * Fast spatial queries on a track: closest centreline point, and the IR reflectance at any point
 * of the surface (line, background, gaps, inverted sections). Analytic, so accurate at any scale.
 */
export class TrackField {
  readonly path: SampledPath;
  readonly halfWidth: number;
  private readonly cell: number;
  private readonly grid = new Map<string, number[]>();
  private readonly gaps: [number, number][];
  private readonly inversions: [number, number][];

  constructor(
    readonly track: Track,
    opts: { stepMm?: number; cellMm?: number } = {},
  ) {
    this.path = sampleTrack(track, opts.stepMm ?? DEFAULT_STEP_MM);
    this.halfWidth = track.lineWidthMm / 2;
    this.cell = opts.cellMm ?? 25;
    const { samples } = this.path;
    for (let i = 0; i + 1 < samples.length; i++) {
      const a = samples[i] as PathSample;
      const b = samples[i + 1] as PathSample;
      // Register the segment a→b in every cell its bounding box touches.
      const x0 = Math.floor(Math.min(a.x, b.x) / this.cell);
      const x1 = Math.floor(Math.max(a.x, b.x) / this.cell);
      const y0 = Math.floor(Math.min(a.y, b.y) / this.cell);
      const y1 = Math.floor(Math.max(a.y, b.y) / this.cell);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const k = `${cx},${cy}`;
          const list = this.grid.get(k);
          if (list) list.push(i);
          else this.grid.set(k, [i]);
        }
      }
    }
    this.gaps = track.features.flatMap((f) =>
      f.type === "gap" ? [[f.startS, f.endS] as [number, number]] : [],
    );
    this.inversions = track.features.flatMap((f) =>
      f.type === "inversion" ? [[f.startS, f.endS] as [number, number]] : [],
    );
  }

  private nearSegments(x: number, y: number, radius: number): number[] {
    const r = Math.ceil(radius / this.cell);
    // Very large searches: every segment is a candidate.
    if (!Number.isFinite(radius) || r > 64)
      return Array.from({ length: Math.max(0, this.path.samples.length - 1) }, (_, i) => i);
    const out = new Set<number>();
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    for (let i = cx - r; i <= cx + r; i++) {
      for (let j = cy - r; j <= cy + r; j++) {
        for (const s of this.grid.get(`${i},${j}`) ?? []) out.add(s);
      }
    }
    return [...out];
  }

  /** Closest point on the centreline within `searchMm` (undefined if none is that close). */
  closest(x: number, y: number, searchMm = 200): ClosestPoint | undefined {
    let best: ClosestPoint | undefined;
    const { samples } = this.path;
    for (const i of this.nearSegments(x, y, searchMm)) {
      const a = samples[i] as PathSample;
      const b = samples[i + 1] as PathSample;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
      const px = a.x + t * dx;
      const py = a.y + t * dy;
      const d = Math.hypot(x - px, y - py);
      if (d <= searchMm && (best === undefined || d < best.distance)) {
        const len = Math.sqrt(len2) || 1;
        const tx = dx / len;
        const ty = dy / len;
        best = {
          s: a.s + t * (b.s - a.s),
          x: px,
          y: py,
          distance: d,
          lateral: tx * (y - py) - ty * (x - px),
          tx,
          ty,
        };
      }
    }
    return best;
  }

  /** Is arc length `s` inside one of the given spans? */
  private static within(s: number, spans: [number, number][]) {
    return spans.some(([a, b]) => s >= a && s <= b);
  }

  /** True if (x, y) is on the painted line (respecting gaps). Crossings work naturally. */
  onLine(x: number, y: number): boolean {
    const { samples } = this.path;
    for (const i of this.nearSegments(x, y, this.halfWidth + 1)) {
      const a = samples[i] as PathSample;
      const b = samples[i + 1] as PathSample;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
      if (Math.hypot(x - a.x - t * dx, y - a.y - t * dy) <= this.halfWidth) {
        const s = a.s + t * (b.s - a.s);
        if (!TrackField.within(s, this.gaps)) return true;
      }
    }
    return false;
  }

  /** IR reflectance (0–1) of the surface at (x, y). */
  reflectanceAt(x: number, y: number): number {
    const { lineReflectance: line, backgroundReflectance: bg } = this.track.surface;
    const near = this.inversions.length > 0 ? this.closest(x, y, this.halfWidth * 4) : undefined;
    // Inverted sections: a band around the path where the colours swap.
    const inverted =
      near !== undefined &&
      near.distance <= this.halfWidth * 4 &&
      TrackField.within(near.s, this.inversions);
    const on = this.onLine(x, y);
    return inverted ? (on ? bg : line) : on ? line : bg;
  }

  /** Point and heading at arc length s (clamped to the path). */
  at(s: number): { x: number; y: number; headingRad: number } {
    const { samples } = this.path;
    let lo = 0;
    let hi = samples.length - 1;
    const target = Math.max(0, Math.min(this.path.length, s));
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((samples[mid] as PathSample).s < target) lo = mid;
      else hi = mid;
    }
    const a = samples[lo] as PathSample;
    const b = samples[hi] as PathSample;
    const f = b.s > a.s ? (target - a.s) / (b.s - a.s) : 0;
    return {
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      headingRad: Math.atan2(a.ty + (b.ty - a.ty) * f, a.tx + (b.tx - a.tx) * f),
    };
  }

  /** Axis-aligned bounds of the painted area (mm). */
  bounds() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of this.path.samples) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const m = this.halfWidth;
    return { minX: minX - m, minY: minY - m, maxX: maxX + m, maxY: maxY + m };
  }
}

/**
 * Progress tracker along a closed or open path that never jumps backwards across the start line
 * or onto a crossing branch: it only accepts a new closest point near the previous one.
 */
export class ProgressTracker {
  private s = 0;
  private laps = 0;
  private started = false;

  constructor(private readonly field: TrackField) {}

  update(
    x: number,
    y: number,
    windowMm = 60,
  ): { s: number; laps: number; total: number; lateral?: number } {
    if (!this.started) {
      // First fix: search the whole track, then follow locally from there.
      this.started = true;
      const c = this.field.closest(x, y, Infinity);
      if (c) this.s = c.s;
    }
    const L = this.field.path.length;
    const { samples } = this.field.path;
    let best: { s: number; d: number; lateral: number } | undefined;
    for (let i = 0; i + 1 < samples.length; i++) {
      const a = samples[i] as PathSample;
      const b = samples[i + 1] as PathSample;
      // Only consider path within ±window of the last known progress (wrapping for loops).
      let ds = a.s - this.s;
      if (ds > L / 2) ds -= L;
      if (ds < -L / 2) ds += L;
      if (Math.abs(ds) > windowMm) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
      const px = a.x + t * dx;
      const py = a.y + t * dy;
      const d = Math.hypot(x - px, y - py);
      if (!best || d < best.d) {
        const len = Math.sqrt(len2) || 1;
        best = {
          s: a.s + t * (b.s - a.s),
          d,
          lateral: (dx / len) * (y - py) - (dy / len) * (x - px),
        };
      }
    }
    if (!best) return { s: this.s, laps: this.laps, total: this.laps * L + this.s };
    if (this.s > L * 0.8 && best.s < L * 0.2) this.laps++;
    else if (this.s < L * 0.2 && best.s > L * 0.8 && this.laps > 0) this.laps--;
    this.s = best.s;
    return { s: this.s, laps: this.laps, total: this.laps * L + this.s, lateral: best.lateral };
  }
}
