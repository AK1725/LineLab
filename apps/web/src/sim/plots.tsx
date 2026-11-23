"use client";

import { TRACE_CHANNELS, type PackedTrace } from "@linelab/sim-core";
import { useMemo } from "react";
import { useRun } from "./run-store";

const W = 600;
const H = 80;
const MAX_POINTS = 600;

interface Series {
  label: string;
  color: string;
  /** Column index in the packed trace. */
  col: number;
}

function Plot({
  trace,
  title,
  unit,
  series,
  endMs,
  fixed,
}: {
  trace: PackedTrace;
  title: string;
  unit: string;
  series: Series[];
  endMs: number;
  fixed?: [number, number];
}) {
  const tMs = useRun((s) => s.tMs);
  const seek = useRun((s) => s.seek);
  const { paths, lo, hi } = useMemo(() => {
    const { data, stride, count } = trace;
    const step = Math.max(1, Math.ceil(count / MAX_POINTS));
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series) {
      for (let i = 0; i < count; i += step) {
        const v = data[i * stride + s.col] ?? 0;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    if (fixed) [lo, hi] = fixed;
    if (!(hi > lo)) {
      lo -= 1;
      hi += 1;
    }
    const pad = (hi - lo) * 0.08;
    lo -= pad;
    hi += pad;
    const paths = series.map((s) => {
      const pts: string[] = [];
      for (let i = 0; i < count; i += step) {
        const t = data[i * stride] ?? 0;
        const v = data[i * stride + s.col] ?? 0;
        pts.push(`${((t / endMs) * W).toFixed(1)},${(H - ((v - lo) / (hi - lo)) * H).toFixed(1)}`);
      }
      return pts.join(" ");
    });
    return { paths, lo, hi };
  }, [trace, series, endMs, fixed]);
  const x = (tMs / endMs) * W;
  const zeroY = lo < 0 && hi > 0 ? H - ((0 - lo) / (hi - lo)) * H : undefined;
  return (
    <figure className="min-w-0">
      <figcaption className="flex items-baseline gap-2 text-xs">
        <span className="font-medium">{title}</span>
        <span className="text-muted">
          {unit} · {lo.toFixed(lo > -10 && hi < 10 ? 2 : 0)} to{" "}
          {hi.toFixed(lo > -10 && hi < 10 ? 2 : 0)}
        </span>
        <span className="ml-auto flex gap-2">
          {series.length <= 3 &&
            series.map((s) => (
              <span key={s.label} style={{ color: s.color }}>
                {s.label}
              </span>
            ))}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-16 w-full cursor-pointer rounded border border-border bg-bg"
        role="img"
        aria-label={`${title} over time`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          seek(((e.clientX - r.left) / r.width) * endMs);
        }}
      >
        {zeroY !== undefined && (
          <line
            x1={0}
            x2={W}
            y1={zeroY}
            y2={zeroY}
            stroke="#94a3b8"
            strokeOpacity={0.5}
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {paths.map((p, i) => (
          <polyline
            key={i}
            points={p}
            fill="none"
            stroke={series[i]?.color}
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <line
          x1={x}
          x2={x}
          y1={0}
          y2={H}
          stroke="#0f9d74"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </figure>
  );
}

const col = (c: (typeof TRACE_CHANNELS)[number]) => TRACE_CHANNELS.indexOf(c);

export function RunPlots({
  trace,
  endMs,
  adcMax,
}: {
  trace: PackedTrace;
  endMs: number;
  adcMax?: number;
}) {
  const sensors = useMemo<Series[]>(
    () =>
      Array.from({ length: trace.sensorCount }, (_, i) => ({
        label: `S${i + 1}`,
        color: `hsl(${(i * 300) / Math.max(1, trace.sensorCount - 1)}, 70%, 45%)`,
        col: TRACE_CHANNELS.length + i,
      })),
    [trace.sensorCount],
  );
  const lateral = useMemo(() => [{ label: "error", color: "#e5484d", col: col("lateralMm") }], []);
  const pwm = useMemo(
    () => [
      { label: "left", color: "#2563eb", col: col("pwmLeft") },
      { label: "right", color: "#d97706", col: col("pwmRight") },
    ],
    [],
  );
  const power = useMemo(
    () => [
      { label: "battery", color: "#7c3aed", col: col("batteryV") },
      { label: "logic", color: "#0891b2", col: col("logicV") },
    ],
    [],
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="run-plots">
      <Plot
        trace={trace}
        title="Lateral error"
        unit="mm (+ = line is right of the sensors)"
        series={lateral}
        endMs={endMs}
      />
      <Plot
        trace={trace}
        title="Sensor readings"
        unit="raw"
        series={sensors}
        endMs={endMs}
        {...(adcMax !== undefined ? { fixed: [0, adcMax] as [number, number] } : {})}
      />
      <Plot
        trace={trace}
        title="Motor PWM"
        unit="duty"
        series={pwm}
        endMs={endMs}
        fixed={[-1, 1]}
      />
      <Plot trace={trace} title="Supply" unit="V" series={power} endMs={endMs} />
    </div>
  );
}
