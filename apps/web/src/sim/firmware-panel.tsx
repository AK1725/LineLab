"use client";

import { useMemo, useState } from "react";
import { TierBadge } from "../firmware/code-view";
import type { FirmwareReport } from "./protocol";
import { useRun } from "./run-store";

/** Firmware details for a run: tier, loop timing, serial output, profile, wiring problems. */
export function FirmwarePanel({ report }: { report: FirmwareReport }) {
  const l = report.loop;
  return (
    <div className="space-y-3" data-testid="firmware-report">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase text-muted">
        Firmware <TierBadge tier={report.tier} />
      </h3>
      {report.wiringProblems.length > 0 && (
        <ul className="list-disc space-y-1 pl-4 text-amber-700 dark:text-amber-400">
          {report.wiringProblems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <dl className="space-y-1">
        <div className="flex justify-between gap-2">
          <dt className="text-muted">Loop period</dt>
          <dd className="tabular-nums" data-testid="loop-period">
            {l
              ? `${l.medianMs.toFixed(2)} ms (p95 ${l.p95Ms.toFixed(2)}, max ${l.maxMs.toFixed(2)})`
              : "—"}
          </dd>
        </div>
        {report.resets > 0 && (
          <div className="flex justify-between gap-2 text-red-600">
            <dt>MCU resets</dt>
            <dd>{report.resets}</dd>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <dt className="text-muted">Simulation speed</dt>
          <dd className="tabular-nums">{report.speed.toFixed(1)}× real time</dd>
        </div>
      </dl>
      <p className="text-xs text-muted">
        Loop period = time between successive reads of the first sensor.
      </p>
      <div>
        <h4 className="text-xs font-semibold uppercase text-muted">Serial</h4>
        <pre
          className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-border bg-bg p-2 text-xs"
          data-testid="serial-output"
        >
          {report.serial || "(nothing printed)"}
        </pre>
      </div>
      {report.hotLines && report.hotLines.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase text-muted">
            Where the CPU spends its time
          </h4>
          <ul className="mt-1 space-y-0.5 text-xs tabular-nums" data-testid="hot-lines">
            {(report.hotFiles ?? []).slice(0, 4).map((f) => (
              <li key={f.file} className="flex justify-between">
                <span>{f.file}</span>
                <span>{(f.share * 100).toFixed(0)} %</span>
              </li>
            ))}
          </ul>
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-muted">By line</summary>
            <ul className="mt-1 space-y-0.5 text-xs tabular-nums">
              {report.hotLines.map((h) => (
                <li key={`${h.file}:${String(h.line)}`} className="flex justify-between">
                  <span>
                    {h.file}:{h.line}
                  </span>
                  <span>{(h.share * 100).toFixed(1)} %</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}

const W = 600;
const H = 60;
const TIMEISH = /micros|millis|time|print|last(Ms|Us)/i;

/** The sketch's global variables over the run (emulated tier). */
export function WatchPlots({
  watch,
  recordEveryMs,
  endMs,
}: {
  watch: NonNullable<FirmwareReport["watch"]>;
  recordEveryMs: number;
  endMs: number;
}) {
  // Controller state first; timestamps (millis/micros bookkeeping) are rarely what you want to see.
  const [shown, setShown] = useState<string[]>(() =>
    [...watch.names].sort((a, b) => Number(TIMEISH.test(a)) - Number(TIMEISH.test(b))).slice(0, 3),
  );
  const tMs = useRun((s) => s.tMs);
  const seek = useRun((s) => s.seek);
  const idx = Math.min(Math.floor(tMs / recordEveryMs), (watch.samples[0]?.length ?? 1) - 1);
  const paths = useMemo(
    () =>
      watch.names.map((_, i) => {
        const xs = watch.samples[i] ?? [];
        let lo = Math.min(...xs);
        let hi = Math.max(...xs);
        if (!(hi > lo)) {
          lo -= 1;
          hi += 1;
        }
        const step = Math.max(1, Math.ceil(xs.length / W));
        const pts: string[] = [];
        for (let j = 0; j < xs.length; j += step)
          pts.push(
            `${(((j * recordEveryMs) / endMs) * W).toFixed(1)},${(H - (((xs[j] ?? 0) - lo) / (hi - lo)) * H).toFixed(1)}`,
          );
        return { d: pts.join(" "), lo, hi };
      }),
    [watch, recordEveryMs, endMs],
  );
  return (
    <section className="mt-3" aria-labelledby="watch-heading" data-testid="watch">
      <h3 id="watch-heading" className="text-xs font-semibold uppercase text-muted">
        Variables
      </h3>
      <div className="mt-1 flex flex-wrap gap-2 text-xs">
        {watch.names.map((n, i) => (
          <label key={n} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={shown.includes(n)}
              onChange={(e) => {
                setShown(e.target.checked ? [...shown, n] : shown.filter((x) => x !== n));
              }}
            />
            <span>
              {n} <span className="text-muted">({watch.types[i]})</span> ={" "}
              <span className="tabular-nums">{fmt(watch.samples[i]?.[idx])}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {watch.names.map((n, i) =>
          shown.includes(n) ? (
            <figure key={n}>
              <figcaption className="text-xs">
                {n}{" "}
                <span className="text-muted">
                  {fmt(paths[i]?.lo)} to {fmt(paths[i]?.hi)}
                </span>
              </figcaption>
              <svg
                viewBox={`0 0 ${W} ${H}`}
                preserveAspectRatio="none"
                className="h-12 w-full cursor-pointer rounded border border-border bg-bg"
                role="img"
                aria-label={`${n} over time`}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  seek(((e.clientX - r.left) / r.width) * endMs);
                }}
              >
                <polyline
                  points={paths[i]?.d}
                  fill="none"
                  stroke="#7c3aed"
                  strokeWidth={1.2}
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={(tMs / endMs) * W}
                  x2={(tMs / endMs) * W}
                  y1={0}
                  y2={H}
                  stroke="#0f9d74"
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </figure>
          ) : null,
        )}
      </div>
    </section>
  );
}

const fmt = (v: number | undefined) =>
  v === undefined ? "—" : Number.isInteger(v) ? String(v) : v.toFixed(3);
