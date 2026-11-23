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

/** Numeric grid-cell key (tracks are far smaller than ±32 k cells). */
const cellKey = (cx: number, cy: number) => (cx + 32768) * 65536 + (cy + 32768);
const EMPTY: readonly number[] = [];

/**
 * Fast spatial queries on a track: closest centreline point, and the IR reflectance at any point
 * of the surface (line, background, gaps, inverted sections). Analytic, so accurate at any scale.
 */
export class TrackField {
  readonly path: SampledPath;
  readonly halfWidth: number;
  private readonly cell: number;
  private readonly grid = new Map<number, number[]>();
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
          const k = cellKey(cx, cy);
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

  private nearSegments(x: number, y: number, radius: number): readonly number[] {
    const c = this.cell;
    const i0 = Math.floor((x - radius) / c);
    const i1 = Math.floor((x + radius) / c);
    const j0 = Math.floor((y - radius) / c);
    const j1 = Math.floor((y + radius) / c);
    // Very large searches: every segment is a candidate.
    if (!Number.isFinite(radius) || (i1 - i0 + 1) * (j1 - j0 + 1) > 4096)
      return Array.from({ length: Math.max(0, this.path.samples.length - 1) }, (_, i) => i);
    if (i0 === i1 && j0 === j1) return this.grid.get(cellKey(i0, j0)) ?? EMPTY;
    // Segments can repeat across cells; callers take a min or an any, so duplicates are harmless.
    const out: number[] = [];
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = this.grid.get(cellKey(i, j));
        if (list) for (const k of list) out.push(k);
      }
    }
    return out;
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
    return this.onLineAmong(this.nearSegments(x, y, this.halfWidth + 1), x, y);
  }

  private onLineAmong(candidates: readonly number[], x: number, y: number): boolean {
    const { samples } = this.path;
    const hw2 = this.halfWidth * this.halfWidth;
    for (const i of candidates) {
      const a = samples[i] as PathSample;
      const b = samples[i + 1] as PathSample;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
      const ex = x - a.x - t * dx;
      const ey = y - a.y - t * dy;
      if (ex * ex + ey * ey <= hw2) {
        const s = a.s + t * (b.s - a.s);
        if (!TrackField.within(s, this.gaps)) return true;
      }
    }
    return false;
  }

  /**
   * Weighted mean reflectance of points around (x, y) — a sensor footprint. `points` holds
   * [dx, dy, weight] offsets no further than `radiusMm` from the centre. One grid lookup serves
   * every point, and the inverted-band test is done once at the centre.
   */
  meanReflectance(
    x: number,
    y: number,
    points: readonly (readonly [number, number, number])[],
    radiusMm: number,
  ): number {
    const { lineReflectance: line, backgroundReflectance: bg } = this.track.surface;
    const inv = this.invertedAt(x, y);
    const cand = this.nearSegments(x, y, radiusMm + this.halfWidth + 1);
    let sum = 0;
    for (const [dx, dy, w] of points) {
      const on = this.onLineAmong(cand, x + dx, y + dy);
      sum += w * (inv ? (on ? bg : line) : on ? line : bg);
    }
    return sum;
  }

  /** IR reflectance (0–1) of the surface at (x, y). */
  reflectanceAt(x: number, y: number): number {
    return this.surfaceAt(x, y, this.invertedAt(x, y));
  }

  /** True inside an inverted section's band (4 line widths wide), where the colours swap. */
  invertedAt(x: number, y: number): boolean {
    if (this.inversions.length === 0) return false;
    const near = this.closest(x, y, this.halfWidth * 4);
    return near !== undefined && TrackField.within(near.s, this.inversions);
  }

  /** Reflectance at (x, y) when it is already known whether the point is in an inverted band
   * (lets a sensor footprint do the band lookup once for all its sample points). */
  surfaceAt(x: number, y: number, inverted: boolean): number {
    const { lineReflectance: line, backgroundReflectance: bg } = this.track.surface;
    const on = this.onLine(x, y);
    return inverted ? (on ? bg : line) : on ? line : bg;
  }

  /** True when the path ends where it starts. */
  get closedLoop(): boolean {
    const a = this.path.samples[0];
    const z = this.path.samples.at(-1);
    return a !== undefined && z !== undefined && Math.hypot(a.x - z.x, a.y - z.y) < 1;
  }

  /** Index of the last sample with arc length ≤ s. */
  indexAt(s: number): number {
    const { samples } = this.path;
    let lo = 0;
    let hi = samples.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((samples[mid] as PathSample).s <= s) lo = mid;
      else hi = mid;
    }
    return lo;
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
  ): { s: number; laps: number; total: number; lateral?: number; distance: number } {
    if (!this.started) {
      // First fix: search the whole track, then follow locally from there.
      this.started = true;
      const c = this.field.closest(x, y, Infinity);
      // On a loop the start and the end are the same point: count from 0, not from L.
      if (c) this.s = this.field.closedLoop && this.field.path.length - c.s < 1 ? 0 : c.s;
    }
    const L = this.field.path.length;
    const { samples } = this.field.path;
    let best: { s: number; d: number; lateral: number } | undefined;
    // Only consider path within ±window of the last known progress (wrapping for loops):
    // binary-search the sample range instead of scanning the whole path.
    const closed = this.field.closedLoop;
    const ranges: [number, number][] = [];
    const lo = this.s - windowMm;
    const hi = this.s + windowMm;
    if (closed && lo < 0) ranges.push([lo + L, L], [0, hi]);
    else if (closed && hi > L) ranges.push([lo, L], [0, hi - L]);
    else ranges.push([Math.max(0, lo), Math.min(L, hi)]);
    for (const [s0, s1] of ranges) {
      for (let i = Math.max(0, this.field.indexAt(s0) - 1); i + 1 < samples.length; i++) {
        const a = samples[i] as PathSample;
        if (a.s > s1) break;
        const b = samples[i + 1] as PathSample;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        const t =
          len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
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
    }
    if (!best)
      return { s: this.s, laps: this.laps, total: this.laps * L + this.s, distance: Infinity };
    // The end of a loop is its start.
    if (closed && best.s > L - 0.5) best.s = 0;
    if (this.s > L * 0.8 && best.s < L * 0.2) this.laps++;
    else if (this.s < L * 0.2 && best.s > L * 0.8 && this.laps > 0) this.laps--;
    this.s = best.s;
    return {
      s: this.s,
      laps: this.laps,
      total: this.laps * L + this.s,
      lateral: best.lateral,
      distance: best.d,
    };
  }
}
