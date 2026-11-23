"use client";

import {
  TRACE_CHANNELS,
  type MonteCarloRun,
  type PackedTrace,
  type ReferencePidOptions,
} from "@linelab/sim-core";
import type { Design, FirmwareArtifact, Track } from "@linelab/schema";
import { create } from "zustand";
import type { RunRequest, RunResponse, RunSummary } from "./protocol";

export interface CompletedRun {
  /** The design as it was when this run started (the ghost keeps its own robot). */
  design: Design;
  summary: RunSummary;
  trace: PackedTrace;
  track: Track;
  runs: MonteCarloRun[];
  robustness: number;
  label: string;
}

export const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4] as const;

interface RunState {
  status: "idle" | "running" | "done" | "error";
  progress: { done: number; total: number } | null;
  error: { message: string; issues?: string[] } | null;
  current: CompletedRun | null;
  /** The previous run, drawn as a ghost. */
  ghost: CompletedRun | null;
  showGhost: boolean;
  tMs: number;
  playing: boolean;
  speed: number;
  camera: "top" | "follow";
  start: (
    design: Design,
    track: Track,
    seeds: number[],
    pid: Partial<ReferencePidOptions>,
    label: string,
    firmware?: FirmwareArtifact,
  ) => void;
  seek: (tMs: number) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
  setCamera: (c: RunState["camera"]) => void;
  setShowGhost: (v: boolean) => void;
}

let worker: Worker | undefined;
let nextId = 0;
let watchdog: ReturnType<typeof setTimeout> | undefined;
/** A worker that hasn't answered for this long is stuck (a HAL sketch looping with no I/O). */
const WATCHDOG_MS = 60_000;

export const useRun = create<RunState>()((set, get) => ({
  status: "idle",
  progress: null,
  error: null,
  current: null,
  ghost: null,
  showGhost: true,
  tMs: 0,
  playing: false,
  speed: 1,
  camera: "top",
  start: (design, track, seeds, pid, label, firmware) => {
    worker ??= new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
    const id = ++nextId;
    set({ status: "running", progress: null, error: null, playing: false });
    const arm = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        worker?.terminate();
        worker = undefined;
        set({
          status: "error",
          progress: null,
          error: {
            message: `The simulation didn't respond for ${WATCHDOG_MS / 1000} s, so it was stopped. A sketch that loops forever without delay(), analogRead() or other I/O never gives the simulator a chance to advance time.`,
          },
        });
      }, WATCHDOG_MS);
    };
    arm();
    worker.onmessage = (e: MessageEvent<RunResponse>) => {
      const msg = e.data;
      if (msg.id !== id) return;
      if (msg.kind === "progress" || msg.kind === "alive") arm();
      else clearTimeout(watchdog);
      if (msg.kind === "alive") return;
      if (msg.kind === "progress") set({ progress: { done: msg.done, total: msg.total } });
      else if (msg.kind === "error")
        set({
          status: "error",
          error: { message: msg.message, ...(msg.issues ? { issues: msg.issues } : {}) },
        });
      else {
        const prev = get().current;
        set({
          status: "done",
          progress: null,
          ghost: prev && prev.track.id === track.id ? prev : null,
          current: {
            design,
            summary: msg.main,
            trace: msg.trace,
            track,
            runs: msg.runs,
            robustness: msg.robustness,
            label,
          },
          tMs: 0,
          playing: true,
        });
      }
    };
    const req: RunRequest = {
      id,
      design,
      track,
      seeds,
      pid,
      laps: 1,
      ...(firmware ? { firmware } : {}),
    };
    worker.postMessage(req);
  },
  seek: (tMs) => {
    set({ tMs });
  },
  setPlaying: (playing) => {
    set({ playing });
  },
  setSpeed: (speed) => {
    set({ speed });
  },
  setCamera: (camera) => {
    set({ camera });
  },
  setShowGhost: (showGhost) => {
    set({ showGhost });
  },
}));

const IDX = Object.fromEntries(TRACE_CHANNELS.map((c, i) => [c, i])) as Record<
  (typeof TRACE_CHANNELS)[number],
  number
>;

/** Interpolated value of a channel at time t (ms). */
export function sampleAt(
  trace: PackedTrace,
  channel: (typeof TRACE_CHANNELS)[number],
  tMs: number,
  recordEveryMs: number,
): number {
  const { data, stride, count } = trace;
  if (count === 0) return 0;
  const f = Math.max(0, Math.min(count - 1, tMs / recordEveryMs));
  const i = Math.floor(f);
  const j = Math.min(count - 1, i + 1);
  const a = data[i * stride + IDX[channel]] ?? 0;
  let b = data[j * stride + IDX[channel]] ?? 0;
  if (channel === "headingRad") b = a + Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + (b - a) * (f - i);
}

export function poseAt(run: CompletedRun, tMs: number) {
  const { trace, summary } = run;
  return {
    x: sampleAt(trace, "xMm", tMs, summary.recordEveryMs),
    y: sampleAt(trace, "yMm", tMs, summary.recordEveryMs),
    heading: sampleAt(trace, "headingRad", tMs, summary.recordEveryMs),
  };
}

export const traceEndMs = (run: CompletedRun) => {
  const { data, stride, count } = run.trace;
  return count > 0 ? (data[(count - 1) * stride] ?? 0) : 0;
};
