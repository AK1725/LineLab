import type { Track } from "@linelab/schema";
import { TrackField } from "@linelab/sim-core";

/** Paint a track (to scale) on a canvas, for use as the floor texture in the run viewer. */
export function paintTrack(track: Track, marginMm = 150, maxPx = 4096) {
  const field = new TrackField(track, { stepMm: 3 });
  const b = field.bounds();
  const minX = b.minX - marginMm;
  const minY = b.minY - marginMm;
  const wMm = b.maxX - b.minX + 2 * marginMm;
  const hMm = b.maxY - b.minY + 2 * marginMm;
  const pxPerMm = Math.min(2, maxPx / Math.max(wMm, hMm));
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(wMm * pxPerMm);
  canvas.height = Math.ceil(hMm * pxPerMm);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  const X = (x: number) => (x - minX) * pxPerMm;
  const Y = (y: number) => canvas.height - (y - minY) * pxPerMm;
  const { lineColor, backgroundColor } = track.surface;
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const stroke = (a: number, z: number, color: string, widthMm: number) => {
    ctx.beginPath();
    let first = true;
    for (const p of field.path.samples) {
      if (p.s < a || p.s > z) continue;
      if (first) ctx.moveTo(X(p.x), Y(p.y));
      else ctx.lineTo(X(p.x), Y(p.y));
      first = false;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = widthMm * pxPerMm;
    ctx.lineJoin = "round";
    ctx.stroke();
  };
  const w = track.lineWidthMm;
  for (const f of track.features)
    if (f.type === "inversion") stroke(f.startS, f.endS, lineColor, w * 4);
  stroke(-1, Infinity, lineColor, w);
  for (const f of track.features) {
    if (f.type === "inversion") stroke(f.startS, f.endS, backgroundColor, w);
    if (f.type === "gap") stroke(f.startS, f.endS, backgroundColor, w + 2);
  }
  return { canvas, minX, minY, wMm, hMm };
}
