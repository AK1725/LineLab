"use client";

import { TRACKS } from "@linelab/component-db";
import type { Track } from "@linelab/schema";
import { DEFAULT_PID } from "@linelab/sim-core";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useDesign } from "../editor/store";
import { TierBadge } from "../firmware/code-view";
import { boardOf, SKETCH_FILE, useFirmware } from "../firmware/store";
import { FirmwarePanel, WatchPlots } from "./firmware-panel";
import { ReportPanel } from "./report-panel";
import AgentPanel from "../agent/agent-panel";
import { listTracks } from "../tracks/storage";
import { RunPlots } from "./plots";
import { SPEEDS, traceEndMs, useRun } from "./run-store";

const RunScene = dynamic(() => import("./run-scene"), { ssr: false });

const OUTCOME_TEXT = {
  finished: "Finished",
  off_track: "Left the track",
  stuck: "Stuck (no progress)",
  timeout: "Ran out of time",
} as const;

function NumberField({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
}) {
  return (
    <label className="flex items-center gap-1 text-xs">
      <span className="text-muted">{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="w-16 rounded border border-border bg-bg px-1 py-0.5 text-right"
      />
    </label>
  );
}

/** Advances the replay clock while playing. */
function usePlayback() {
  const playing = useRun((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const s = useRun.getState();
      const run = s.current;
      if (!run) return;
      const end = traceEndMs(run);
      const t = Math.min(end, s.tMs + (now - last) * s.speed);
      last = now;
      s.seek(t);
      if (t >= end) s.setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [playing]);
}

function Timeline() {
  const run = useRun((s) => s.current);
  const tMs = useRun((s) => s.tMs);
  const playing = useRun((s) => s.playing);
  const speed = useRun((s) => s.speed);
  const camera = useRun((s) => s.camera);
  const ghost = useRun((s) => s.ghost);
  const showGhost = useRun((s) => s.showGhost);
  const st = useRun.getState();
  if (!run) return null;
  const end = traceEndMs(run);
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2 text-sm">
      <button
        type="button"
        onClick={() => {
          if (!playing && tMs >= end) st.seek(0);
          st.setPlaying(!playing);
        }}
        className="w-16 rounded-md border border-border px-2 py-1 hover:border-accent"
      >
        {playing ? "Pause" : "Play"}
      </button>
      <input
        type="range"
        aria-label="Replay time"
        min={0}
        max={end}
        step={10}
        value={tMs}
        onChange={(e) => {
          st.setPlaying(false);
          st.seek(Number(e.target.value));
        }}
        className="min-w-40 flex-1 accent-[var(--color-accent)]"
      />
      <span className="w-24 text-right tabular-nums text-muted" data-testid="replay-time">
        {(tMs / 1000).toFixed(2)} / {(end / 1000).toFixed(2)} s
      </span>
      <label className="flex items-center gap-1">
        <span className="text-muted">Speed</span>
        <select
          aria-label="Playback speed"
          value={speed}
          onChange={(e) => {
            st.setSpeed(Number(e.target.value));
          }}
          className="rounded-md border border-border bg-bg px-1 py-1"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1">
        <span className="text-muted">Camera</span>
        <select
          aria-label="Camera"
          value={camera}
          onChange={(e) => {
            st.setCamera(e.target.value as "top" | "follow");
          }}
          className="rounded-md border border-border bg-bg px-1 py-1"
        >
          <option value="top">Top</option>
          <option value="follow">Follow</option>
        </select>
      </label>
      {ghost && (
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={showGhost}
            onChange={(e) => {
              st.setShowGhost(e.target.checked);
            }}
          />
          Ghost: {ghost.label}
        </label>
      )}
    </div>
  );
}

function Results() {
  const run = useRun((s) => s.current);
  if (!run) return null;
  const { summary: s } = run;
  const m = s.metrics;
  const rows: [string, string][] = [
    ["Completed", `${m.completionPct.toFixed(0)} %`],
    ["Lap time", m.lapTimeMs !== undefined ? `${(m.lapTimeMs / 1000).toFixed(2)} s` : "—"],
    [
      "Mean / max error",
      `${m.meanLateralErrorMm.toFixed(1)} / ${m.maxLateralErrorMm.toFixed(0)} mm`,
    ],
    ["Oscillation", `${(m.oscillationIndex ?? 0).toFixed(2)} Hz`],
    ["Energy", `${(m.energyJ ?? 0).toFixed(1)} J`],
    ["Control loop", m.loopFrequencyHz ? `${m.loopFrequencyHz.toFixed(0)} Hz` : "—"],
  ];
  return (
    <section aria-labelledby="results-heading" className="space-y-3 p-3 text-sm">
      <h2 id="results-heading" className="font-semibold">
        Result
      </h2>
      <p
        data-testid="run-outcome"
        data-outcome={s.outcome}
        className={`rounded-md px-2 py-1 font-medium ${s.outcome === "finished" ? "bg-accent/15 text-accent" : "bg-red-500/10 text-red-600"}`}
      >
        {OUTCOME_TEXT[s.outcome]}
      </p>
      <dl className="space-y-1" data-testid="run-metrics">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <dt className="text-muted">{k}</dt>
            <dd className="tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <ReportPanel run={run} />
      {run.runs.length > 1 && (
        <div data-testid="monte-carlo">
          <h3 className="text-xs font-semibold uppercase text-muted">Monte Carlo</h3>
          <p className="mt-1">
            Robustness: <strong>{Math.round(run.robustness * 100)} %</strong> (
            {run.runs.filter((r) => r.outcome === "finished").length}/{run.runs.length} seeds
            finished)
          </p>
          <table className="mt-1 w-full text-xs tabular-nums">
            <thead>
              <tr className="text-muted">
                <th className="text-left font-normal">Seed</th>
                <th className="text-left font-normal">Outcome</th>
                <th className="text-right font-normal">Lap</th>
                <th className="text-right font-normal">Err</th>
              </tr>
            </thead>
            <tbody>
              {run.runs.map((r) => (
                <tr key={r.seed}>
                  <td>{r.seed}</td>
                  <td>{r.outcome.replace("_", " ")}</td>
                  <td className="text-right">
                    {r.metrics.lapTimeMs !== undefined
                      ? (r.metrics.lapTimeMs / 1000).toFixed(2)
                      : "—"}
                  </td>
                  <td className="text-right">{r.metrics.meanLateralErrorMm.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {s.notes.length > 0 && (
        <ul className="space-y-1 text-xs text-muted">
          {s.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {s.firmware ? (
        <FirmwarePanel report={s.firmware} />
      ) : (
        <p className="text-xs text-muted">Controller: built-in reference PID.</p>
      )}
      <p className="text-xs text-muted">
        Seed {s.seed}, trace {s.hash}.
      </p>
    </section>
  );
}

export default function RunView() {
  const design = useDesign();
  const [saved, setSaved] = useState<Track[]>([]);
  const [trackId, setTrackId] = useState("track.oval");
  const [seed, setSeed] = useState(0);
  const [mc, setMc] = useState(0);
  const [pid, setPid] = useState({
    baseDuty: DEFAULT_PID.baseDuty,
    kp: DEFAULT_PID.kp,
    kd: DEFAULT_PID.kd,
  });
  const status = useRun((s) => s.status);
  const progress = useRun((s) => s.progress);
  const error = useRun((s) => s.error);
  const run = useRun((s) => s.current);
  const artifact = useFirmware((s) => s.artifact);
  const fwDesign = useFirmware((s) => s.designId);
  const [controller, setController] = useState<"reference" | "firmware">("reference");
  const board = boardOf(design);
  const firmwareReady =
    artifact !== null && fwDesign === design.id && artifact.board === board?.board;
  usePlayback();
  useEffect(() => {
    void useFirmware.getState().load(design);
  }, [design]);
  useEffect(() => {
    listTracks().then(
      (xs) => {
        setSaved(xs.map((x) => x.track));
      },
      () => undefined,
    );
  }, []);
  const tracks = useMemo(() => [...TRACKS, ...saved], [saved]);
  const track = tracks.find((t) => t.id === trackId);

  /** Run the firmware now in the editor (e.g. a verified fix); the previous run becomes the ghost. */
  const rerunFirmware = (d: typeof design, t: Track, s: number) => {
    const fw = useFirmware.getState();
    if (!fw.artifact) return;
    setController("firmware");
    useRun.getState().start(d, t, [s], pid, "after the AI fix", fw.artifact, {
      text: fw.source,
      file: SKETCH_FILE,
    });
  };

  const start = () => {
    if (!track) return;
    const seeds =
      mc > 1 ? [seed, ...Array.from({ length: mc - 1 }, (_, i) => seed + i + 1)] : [seed];
    if (controller === "firmware" && artifact && firmwareReady) {
      useRun.getState().start(design, track, seeds, pid, `firmware, seed ${seed}`, artifact, {
        text: useFirmware.getState().source,
        file: SKETCH_FILE,
      });
    } else {
      useRun
        .getState()
        .start(design, track, seeds, pid, `seed ${seed}, Kp ${pid.kp}, base ${pid.baseDuty}`);
    }
  };

  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[1fr_19rem]">
      <div className="flex min-h-0 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2 text-sm">
          <label className="flex items-center gap-1">
            <span className="text-muted">Track</span>
            <select
              aria-label="Track"
              value={trackId}
              onChange={(e) => {
                setTrackId(e.target.value);
              }}
              className="max-w-48 rounded-md border border-border bg-bg px-1 py-1"
            >
              <optgroup label="Built-in">
                {TRACKS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.difficulty ?? "—"})
                  </option>
                ))}
              </optgroup>
              {saved.length > 0 && (
                <optgroup label="Your tracks">
                  {saved.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <NumberField
            label="Seed"
            value={seed}
            step={1}
            onChange={(v) => {
              setSeed(Math.max(0, Math.round(v)));
            }}
          />
          <label className="flex items-center gap-1 text-xs">
            <span className="text-muted">Monte Carlo</span>
            <select
              aria-label="Monte Carlo runs"
              value={mc}
              onChange={(e) => {
                setMc(Number(e.target.value));
              }}
              className="rounded border border-border bg-bg px-1 py-0.5"
            >
              <option value={0}>off</option>
              {[10, 25, 50].map((n) => (
                <option key={n} value={n}>
                  {n} seeds
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            <span className="text-muted">Controller</span>
            <select
              aria-label="Controller"
              value={controller}
              onChange={(e) => {
                setController(e.target.value as "reference" | "firmware");
              }}
              className="rounded-md border border-border bg-bg px-1 py-1"
            >
              <option value="reference">Reference PID</option>
              <option value="firmware" disabled={!firmwareReady}>
                My firmware{firmwareReady ? "" : " (compile it in Code)"}
              </option>
            </select>
          </label>
          {controller === "firmware" && board && <TierBadge tier={board.tier} />}
          {controller === "reference" && (
            <span className="flex items-center gap-2" title="Reference PID controller gains">
              <NumberField
                label="Base"
                value={pid.baseDuty}
                step={0.05}
                onChange={(v) => {
                  setPid({ ...pid, baseDuty: v });
                }}
              />
              <NumberField
                label="Kp"
                value={pid.kp}
                step={0.1}
                onChange={(v) => {
                  setPid({ ...pid, kp: v });
                }}
              />
              <NumberField
                label="Kd"
                value={pid.kd}
                step={0.005}
                onChange={(v) => {
                  setPid({ ...pid, kd: v });
                }}
              />
            </span>
          )}
          <button
            type="button"
            data-testid="run-start"
            onClick={start}
            disabled={status === "running" || !track}
            className="ml-auto rounded-lg bg-accent px-4 py-1.5 font-medium text-white disabled:opacity-50 dark:text-black"
          >
            {status === "running"
              ? progress
                ? `Running ${progress.done}/${progress.total}…`
                : "Running…"
              : "Run"}
          </button>
        </div>
        {error && (
          <div
            role="alert"
            className="m-3 rounded-md border border-red-500/40 bg-red-500/5 p-3 text-sm"
          >
            <p className="font-medium text-red-600">Can&apos;t simulate this design yet.</p>
            <ul className="mt-1 list-disc pl-5">
              {(error.issues ?? [error.message]).map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="relative min-h-[280px] flex-1 bg-card" data-testid="run-viewer">
          {run ? (
            <RunScene />
          ) : (
            <p className="p-6 text-sm text-muted">
              Pick a track and press <strong>Run</strong>. The robot drives with a built-in
              reference PID controller; the physics uses your parts&apos; datasheet values (motors,
              battery, driver, wheels, sensors, mass).
            </p>
          )}
        </div>
        {run && (
          <p className="border-t border-border px-3 pt-1 text-xs text-muted">
            Green line: path of the robot&apos;s centre (axle midpoint). It cuts inside curves
            because the sensors look ahead.{" "}
          </p>
        )}
        {run && <Timeline />}
        {run && (
          <div className="max-h-[40vh] overflow-y-auto border-t border-border p-3">
            <RunPlots trace={run.trace} endMs={Math.max(1, traceEndMs(run))} />
            {run.summary.firmware?.watch && run.summary.firmware.watch.names.length > 0 && (
              <WatchPlots
                watch={run.summary.firmware.watch}
                recordEveryMs={run.summary.recordEveryMs}
                endMs={Math.max(1, traceEndMs(run))}
              />
            )}
            {run.summary.controller === "firmware" && (
              <div className="mt-3">
                <AgentPanel
                  design={run.design}
                  track={run.track}
                  seed={run.summary.seed}
                  onRerun={() => {
                    rerunFirmware(run.design, run.track, run.summary.seed);
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>
      <aside className="min-h-0 overflow-y-auto border-t border-border lg:border-l lg:border-t-0">
        <Results />
      </aside>
    </div>
  );
}
