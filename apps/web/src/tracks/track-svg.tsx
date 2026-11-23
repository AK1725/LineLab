import { TrackField } from "@linelab/sim-core";
import type { Track } from "@linelab/schema";

/** Polyline points (SVG coords: y flipped) for the samples between arc lengths a and b. */
function pointsBetween(field: TrackField, a: number, b: number): string {
  return field.path.samples
    .filter((p) => p.s >= a && p.s <= b)
    .map((p) => `${p.x.toFixed(1)},${(-p.y).toFixed(1)}`)
    .join(" ");
}

/**
 * Top view of a track drawn to scale: the painted line, gaps (unpainted), inverted sections,
 * start (green arrow) and finish (chequered) markers, and an optional 100 mm grid.
 */
export function TrackSvg({
  track,
  className,
  grid = false,
  title,
}: {
  track: Track;
  className?: string;
  grid?: boolean;
  title?: string;
}) {
  const field = new TrackField(track, { stepMm: 3 });
  const b = field.bounds();
  const pad = 40;
  const vb = `${b.minX - pad} ${-b.maxY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`;
  const all = pointsBetween(field, -1, Infinity);
  const { lineColor, backgroundColor } = track.surface;
  const w = track.lineWidthMm;
  const startArrow = (() => {
    const { x, y, headingRad: h } = track.start;
    const L = Math.max(40, w * 2.5);
    const tip = [x + L * Math.cos(h), -(y + L * Math.sin(h))];
    const l = [x + 0.4 * L * Math.cos(h + 2.6), -(y + 0.4 * L * Math.sin(h + 2.6))];
    const r = [x + 0.4 * L * Math.cos(h - 2.6), -(y + 0.4 * L * Math.sin(h - 2.6))];
    return `${tip.join(",")} ${l.join(",")} ${r.join(",")}`;
  })();
  const gridLines: React.ReactNode[] = [];
  if (grid) {
    for (let x = Math.floor((b.minX - pad) / 100) * 100; x <= b.maxX + pad; x += 100) {
      gridLines.push(
        <line
          key={`x${x}`}
          x1={x}
          x2={x}
          y1={-b.maxY - pad}
          y2={-b.minY + pad}
          stroke="#94a3b8"
          strokeOpacity={0.25}
          strokeWidth={1}
        />,
      );
    }
    for (let y = Math.floor((b.minY - pad) / 100) * 100; y <= b.maxY + pad; y += 100) {
      gridLines.push(
        <line
          key={`y${y}`}
          y1={-y}
          y2={-y}
          x1={b.minX - pad}
          x2={b.maxX + pad}
          stroke="#94a3b8"
          strokeOpacity={0.25}
          strokeWidth={1}
        />,
      );
    }
  }
  return (
    <svg
      viewBox={vb}
      className={className}
      role="img"
      aria-label={title ?? `${track.name} track`}
      data-testid="track-svg"
    >
      <rect
        x={b.minX - pad}
        y={-b.maxY - pad}
        width={b.maxX - b.minX + 2 * pad}
        height={b.maxY - b.minY + 2 * pad}
        fill={backgroundColor}
      />
      {gridLines}
      {track.features.map((f, i) =>
        f.type === "inversion" ? (
          <polyline
            key={`inv${i}`}
            points={pointsBetween(field, f.startS, f.endS)}
            fill="none"
            stroke={lineColor}
            strokeWidth={w * 4}
            strokeLinejoin="round"
          />
        ) : null,
      )}
      <polyline
        points={all}
        fill="none"
        stroke={lineColor}
        strokeWidth={w}
        strokeLinejoin="round"
        strokeLinecap="butt"
      />
      {track.features.map((f, i) =>
        f.type === "inversion" ? (
          <polyline
            key={`invl${i}`}
            points={pointsBetween(field, f.startS, f.endS)}
            fill="none"
            stroke={backgroundColor}
            strokeWidth={w}
          />
        ) : f.type === "gap" ? (
          <polyline
            key={`gap${i}`}
            points={pointsBetween(field, f.startS, f.endS)}
            fill="none"
            stroke={backgroundColor}
            strokeWidth={w + 2}
          />
        ) : f.type === "junction" ? (
          <circle
            key={`j${i}`}
            cx={f.position.x}
            cy={-f.position.y}
            r={w * 0.8}
            fill="none"
            stroke="#f59e0b"
            strokeWidth={3}
          />
        ) : null,
      )}
      <polygon points={startArrow} fill="#16a34a" stroke="#ffffff" strokeWidth={2} />
      {track.finish && (
        <rect
          x={track.finish.x - w}
          y={-track.finish.y - w}
          width={w * 2}
          height={w * 2}
          fill="#ef4444"
          stroke="#ffffff"
          strokeWidth={2}
        />
      )}
    </svg>
  );
}

/** Basic stats for display. */
export function trackStats(track: Track) {
  const field = new TrackField(track, { stepMm: 2 });
  const radii = track.segments.flatMap((s) => (s.type === "arc" ? [s.radiusMm] : []));
  const b = field.bounds();
  return {
    lengthM: field.path.length / 1000,
    minRadiusMm: radii.length > 0 ? Math.min(...radii) : undefined,
    sizeMm: { x: b.maxX - b.minX, y: b.maxY - b.minY },
    gaps: track.features.filter((f) => f.type === "gap").length,
    inversions: track.features.filter((f) => f.type === "inversion").length,
    crossings: track.features.filter((f) => f.type === "crossing").length,
    junctions: track.features.filter((f) => f.type === "junction").length,
    closed: (() => {
      const s = field.path.samples;
      const a = s[0];
      const z = s.at(-1);
      return a !== undefined && z !== undefined && Math.hypot(a.x - z.x, a.y - z.y) < 1;
    })(),
  };
}
