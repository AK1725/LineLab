import type { Pose, Track, TrackFeature, TrackSegment } from "@linelab/schema";

const r2 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Turtle-style track builder: walk forward, turn along arcs. Every segment starts exactly where
 * the previous one ended, so tracks are continuous by construction.
 *
 *   new TrackBuilder({ x: 0, y: 0, headingRad: 0 }).forward(500).left(90, 200).forward(300)...
 */
export class TrackBuilder {
  private x: number;
  private y: number;
  private h: number;
  private s = 0;
  readonly segments: TrackSegment[] = [];
  readonly features: TrackFeature[] = [];

  constructor(start: Pose = { x: 0, y: 0, headingRad: 0 }) {
    this.x = start.x;
    this.y = start.y;
    this.h = start.headingRad;
  }

  get pose(): Pose {
    return { x: r2(this.x), y: r2(this.y), headingRad: this.h };
  }

  get length(): number {
    return this.s;
  }

  forward(mm: number): this {
    const to = { x: this.x + mm * Math.cos(this.h), y: this.y + mm * Math.sin(this.h) };
    this.segments.push({
      type: "line",
      from: { x: r2(this.x), y: r2(this.y) },
      to: { x: r2(to.x), y: r2(to.y) },
    });
    this.x = to.x;
    this.y = to.y;
    this.s += mm;
    return this;
  }

  /** Turn along an arc. Positive degrees turn left (counter-clockwise). */
  turn(deg: number, radiusMm: number): this {
    const sweep = (deg * Math.PI) / 180;
    const side = Math.sign(sweep) || 1;
    const cx = this.x - side * radiusMm * Math.sin(this.h);
    const cy = this.y + side * radiusMm * Math.cos(this.h);
    const start = Math.atan2(this.y - cy, this.x - cx);
    this.segments.push({
      type: "arc",
      center: { x: r2(cx), y: r2(cy) },
      radiusMm,
      startAngleRad: start,
      sweepRad: sweep,
    });
    this.x = cx + radiusMm * Math.cos(start + sweep);
    this.y = cy + radiusMm * Math.sin(start + sweep);
    this.h += sweep;
    this.s += Math.abs(sweep) * radiusMm;
    return this;
  }

  left(deg: number, radiusMm: number): this {
    return this.turn(Math.abs(deg), radiusMm);
  }

  right(deg: number, radiusMm: number): this {
    return this.turn(-Math.abs(deg), radiusMm);
  }

  /** The next `mm` of track will be drawn but with no paint (a gap in the line). */
  gapNext(mm: number): this {
    this.features.push({ type: "gap", startS: r2(this.s), endS: r2(this.s + mm) });
    return this;
  }

  /** The next `mm` of track will have line and background colours swapped. */
  invertNext(mm: number): this {
    this.features.push({ type: "inversion", startS: r2(this.s), endS: r2(this.s + mm) });
    return this;
  }

  checkpoint(index: number): this {
    this.features.push({ type: "checkpoint", position: { x: r2(this.x), y: r2(this.y) }, index });
    return this;
  }

  crossingHere(): this {
    this.features.push({ type: "crossing", position: { x: r2(this.x), y: r2(this.y) } });
    return this;
  }

  build(
    meta: Pick<Track, "id" | "name"> &
      Partial<Pick<Track, "description" | "difficulty" | "lineWidthMm" | "surface">>,
    start: Pose,
  ): Track {
    const t: Track = {
      id: meta.id,
      name: meta.name,
      units: "mm",
      surface: meta.surface ?? {
        lineColor: "#111111",
        backgroundColor: "#f5f5f0",
        lineReflectance: 0.05,
        backgroundReflectance: 0.85,
      },
      lineWidthMm: meta.lineWidthMm ?? 19,
      segments: this.segments,
      features: this.features,
      start,
    };
    if (meta.description) t.description = meta.description;
    if (meta.difficulty) t.difficulty = meta.difficulty;
    return t;
  }
}
