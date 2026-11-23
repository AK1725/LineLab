import type { Track, Vec2 } from "@linelab/schema";
import { segmentPoints } from "./geometry.js";

export interface TrackProblem {
  message: string;
}

const endpoints = (t: Track) =>
  t.segments.map((seg) => {
    const pts = segmentPoints(seg, 5);
    return { start: pts[0] as Vec2, end: pts.at(-1) as Vec2 };
  });

/**
 * Geometry checks a JSON Schema can't express:
 * - consecutive segments join (gap < 0.5 mm), unless the track declares junctions (mazes)
 * - arcs are not tighter than the line is wide
 * - feature arc-length spans lie on the track
 * - the start pose is on the line
 */
export function validateTrackGeometry(t: Track): TrackProblem[] {
  const problems: TrackProblem[] = [];
  const ends = endpoints(t);
  const maze = t.features.some((f) => f.type === "junction");
  if (!maze) {
    for (let i = 1; i < ends.length; i++) {
      const a = ends[i - 1]?.end as Vec2;
      const b = ends[i]?.start as Vec2;
      const gap = Math.hypot(a.x - b.x, a.y - b.y);
      if (gap > 0.5)
        problems.push({
          message: `segment ${i} starts ${gap.toFixed(1)} mm away from the end of segment ${i - 1}`,
        });
    }
  }
  t.segments.forEach((s, i) => {
    if (s.type === "arc" && s.radiusMm < t.lineWidthMm) {
      problems.push({
        message: `segment ${i}: arc radius ${s.radiusMm} mm is tighter than the ${t.lineWidthMm} mm line`,
      });
    }
  });
  let length = 0;
  for (const seg of t.segments) {
    const pts = segmentPoints(seg, 1);
    for (let i = 1; i < pts.length; i++)
      length += Math.hypot(
        (pts[i] as Vec2).x - (pts[i - 1] as Vec2).x,
        (pts[i] as Vec2).y - (pts[i - 1] as Vec2).y,
      );
  }
  for (const f of t.features) {
    if ((f.type === "gap" || f.type === "inversion") && f.endS > length + 1) {
      problems.push({
        message: `${f.type} ends at ${f.endS.toFixed(0)} mm but the track is only ${length.toFixed(0)} mm long`,
      });
    }
  }
  const nearest = Math.min(
    ...t.segments.flatMap((seg) =>
      segmentPoints(seg, 2).map((p) => Math.hypot(p.x - t.start.x, p.y - t.start.y)),
    ),
  );
  if (nearest > t.lineWidthMm / 2)
    problems.push({ message: `start pose is ${nearest.toFixed(1)} mm off the line` });
  return problems;
}
