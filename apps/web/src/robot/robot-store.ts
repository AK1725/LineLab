"use client";

import type { AutotuneResult, CalibrationResult } from "@linelab/calibrate";
import { parseIntelHex } from "@linelab/firmware-runtime";
import {
  TelemetryRecording,
  type Design,
  type FirmwareArtifact,
  type Track,
} from "@linelab/schema";
import { FrameDecoder, RecordingBuilder, type TelemetryHello } from "@linelab/telemetry-lib";
import { create } from "zustand";
import { openBle, openSerial, type RobotLink } from "./link";
import { ATMEGA328P, FlashError, flashStk500, hexExtent, type FlashProgress } from "./stk500";
import type { TuneRequest, TuneResponse } from "./tune-protocol";

/** Live samples kept for the plots (10 s at 100 Hz). */
const LIVE_SAMPLES = 1000;

export type LiveSample = TelemetryRecording["samples"][number];

interface RobotState {
  link: RobotLink | null;
  connecting: boolean;
  error: string | null;
  hello: TelemetryHello | null;
  live: LiveSample[];
  /** Received counts, for the status line. */
  stats: { samples: number; badFrames: number; skippedBytes: number; bytes: number };
  log: string[];
  recordingActive: boolean;
  /** The recording to calibrate from: recorded here or loaded from a file. */
  recording: TelemetryRecording | null;
  flash: {
    status: "idle" | "flashing" | "done" | "error";
    progress?: FlashProgress;
    message?: string;
    hint?: string;
  };
  tune: {
    status: "idle" | "running" | "done" | "error";
    kind?: "calibrate" | "autotune";
    progress?: { done: number; total: number; best: number };
    calibration?: CalibrationResult;
    autotune?: AutotuneResult;
    message?: string;
  };
  connect: (kind: "serial" | "ble", baud: number) => Promise<void>;
  disconnect: () => Promise<void>;
  startRecording: () => void;
  stopRecording: () => void;
  loadRecording: (text: string) => void;
  setRecording: (r: TelemetryRecording | null) => void;
  flashFirmware: (artifact: FirmwareArtifact, bootloaderBaud: number) => Promise<void>;
  calibrate: (design: Design, track: Track, firmware: FirmwareArtifact | undefined) => void;
  autotune: (design: Design, track: Track) => void;
  cancelTune: () => void;
}

let decoder = new FrameDecoder();
let builder: RecordingBuilder | null = null;
let worker: Worker | undefined;
let nextId = 0;

declare global {
  interface Window {
    __linelabRobot?: typeof useRobot;
  }
}

export const useRobot = create<RobotState>()((set, get) => {
  const onBytes = (b: Uint8Array) => {
    const frames = decoder.push(b);
    const s = get();
    const live = [...s.live];
    let hello = s.hello;
    const log = [...s.log];
    for (const f of frames) {
      builder?.add(f);
      if (f.type === "hello") hello = f;
      else if (f.type === "text") log.push(f.text);
      else {
        live.push({
          tMs: f.tUs / 1000,
          sensors: f.sensors,
          pwmLeft: f.pwmLeft,
          pwmRight: f.pwmRight,
          lineLost: f.lineLost,
          vars: f.vars,
          ...(f.batteryV !== undefined ? { batteryV: f.batteryV } : {}),
          ...(f.encoders ? { encoders: f.encoders } : {}),
        });
      }
    }
    set({
      live: live.length > LIVE_SAMPLES ? live.slice(-LIVE_SAMPLES) : live,
      hello,
      log: log.slice(-200),
      stats: {
        samples: s.stats.samples + frames.filter((f) => f.type === "sample").length,
        badFrames: decoder.badFrames,
        skippedBytes: decoder.skippedBytes,
        bytes: s.stats.bytes + b.length,
      },
    });
  };

  const runTune = (
    req: TuneRequest extends infer T ? (T extends TuneRequest ? Omit<T, "id"> : never) : never,
  ) => {
    worker?.terminate();
    worker = new Worker(new URL("./tune.worker.ts", import.meta.url), { type: "module" });
    const id = ++nextId;
    set({ tune: { status: "running", kind: req.kind } });
    worker.onmessage = (e: MessageEvent<TuneResponse>) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.kind === "progress")
        set((s) => ({
          tune: { ...s.tune, progress: { done: m.done, total: m.total, best: m.best } },
        }));
      else if (m.kind === "calibrated")
        set({ tune: { status: "done", kind: "calibrate", calibration: m.result } });
      else if (m.kind === "tuned")
        set({ tune: { status: "done", kind: "autotune", autotune: m.result } });
      else set({ tune: { status: "error", kind: req.kind, message: m.message } });
    };
    worker.onerror = (e) => {
      set({
        tune: { status: "error", kind: req.kind, message: e.message || "The worker crashed." },
      });
    };
    worker.postMessage({ ...req, id });
  };

  return {
    link: null,
    connecting: false,
    error: null,
    hello: null,
    live: [],
    stats: { samples: 0, badFrames: 0, skippedBytes: 0, bytes: 0 },
    log: [],
    recordingActive: false,
    recording: null,
    flash: { status: "idle" },
    tune: { status: "idle" },

    connect: async (kind, baud) => {
      if (get().link) await get().disconnect();
      set({ connecting: true, error: null });
      try {
        const link = kind === "serial" ? await openSerial(baud) : await openBle();
        decoder = new FrameDecoder();
        link.onClose = (reason) => {
          set({ link: null, recordingActive: false, error: reason ?? null });
        };
        set({
          link,
          connecting: false,
          hello: null,
          live: [],
          log: [],
          stats: { samples: 0, badFrames: 0, skippedBytes: 0, bytes: 0 },
        });
        // Last: this delivers anything already received (the sketch's hello).
        link.onBytes = onBytes;
      } catch (e) {
        // A closed picker is not an error worth showing.
        const msg = e instanceof Error ? e.message : String(e);
        set({
          connecting: false,
          error: /cancel|No port selected|User cancelled/i.test(msg) ? null : msg,
        });
      }
    },
    disconnect: async () => {
      const l = get().link;
      set({ link: null, recordingActive: false });
      await l?.close();
    },
    startRecording: () => {
      builder = new RecordingBuilder("real");
      const h = get().hello;
      if (h) builder.add(h);
      set({ recordingActive: true });
    },
    stopRecording: () => {
      const r = builder?.build();
      builder = null;
      set({ recordingActive: false, ...(r && r.samples.length > 0 ? { recording: r } : {}) });
    },
    loadRecording: (text) => {
      const parsed = TelemetryRecording.safeParse(JSON.parse(text));
      if (!parsed.success) throw new Error("That file isn't a LineLab telemetry recording.");
      set({ recording: parsed.data });
    },
    setRecording: (recording) => {
      set({ recording });
    },

    flashFirmware: async (artifact, bootloaderBaud) => {
      const link = get().link;
      if (!link?.withBootloader || !artifact.hex) return;
      set({ flash: { status: "flashing" } });
      try {
        const image = parseIntelHex(artifact.hex, ATMEGA328P.flashBytes);
        const end = hexExtent(artifact.hex);
        const r = await link.withBootloader(bootloaderBaud, (t) =>
          flashStk500(t, image.subarray(0, end), (p) => {
            set({ flash: { status: "flashing", progress: p } });
          }),
        );
        set({
          flash: {
            status: "done",
            message: `Flashed and verified ${r.bytes} bytes (${r.pages} pages).`,
          },
        });
      } catch (e) {
        set({
          flash: {
            status: "error",
            message: e instanceof Error ? e.message : String(e),
            ...(e instanceof FlashError && e.hint ? { hint: e.hint } : {}),
          },
        });
      } finally {
        decoder = new FrameDecoder();
      }
    },

    calibrate: (design, track, firmware) => {
      const recording = get().recording;
      if (!recording) return;
      runTune({
        kind: "calibrate",
        design,
        track,
        recording,
        ...(firmware ? { firmware } : {}),
        maxEvals: firmware ? 100 : 160,
      });
    },
    autotune: (design, track) => {
      runTune({ kind: "autotune", design, track, iterations: 20 });
    },
    cancelTune: () => {
      worker?.terminate();
      worker = undefined;
      set({ tune: { status: "idle" } });
    },
  };
});

if (typeof window !== "undefined") window.__linelabRobot = useRobot;
