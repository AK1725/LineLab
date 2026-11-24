"use client";

import { getComponent } from "@linelab/component-db";
import { EMULATED_BOARDS } from "@linelab/firmware-runtime";
import {
  AnalyzeResponse,
  Board,
  CompileResponse,
  FirmwareArtifact,
  type FirmwareFinding,
  type CompileDiagnostic,
  type Design,
} from "@linelab/schema";
import { createStore, get, set, type UseStore } from "idb-keyval";
import { z } from "zod";
import { create } from "zustand";
import { prebuiltFor, starterFor } from "./examples";

const Saved = z.object({
  board: Board,
  source: z.string(),
  artifact: FirmwareArtifact.optional(),
  updatedAt: z.number(),
});

/** The name the sketch is compiled under (line numbers in reports refer to it). */
export const SKETCH_FILE = "sketch.ino";

let idb: UseStore | undefined;
const db = () => (idb ??= createStore("linelab-firmware", "sketches"));

/** The design's microcontroller board, and whether its firmware is emulated or runs on the HAL. */
export function boardOf(
  design: Design,
): { board: Board; name: string; tier: "emulated" | "hal" } | undefined {
  for (const p of design.placements) {
    const c = getComponent(p.componentId);
    if (c?.electrical.kind === "mcu" && c.electrical.fqbn)
      return {
        board: c.electrical.fqbn,
        name: c.name,
        tier: EMULATED_BOARDS.has(c.id) ? "emulated" : "hal",
      };
  }
  return undefined;
}

interface FirmwareState {
  designId: string | null;
  board: Board | null;
  source: string;
  /** The artifact for the current source (compiled or prebuilt); null if the source changed since. */
  artifact: FirmwareArtifact | null;
  status: "idle" | "compiling" | "ok" | "error";
  diagnostics: CompileDiagnostic[];
  log: string;
  message: string;
  /** cppcheck / clang-tidy findings for the last compiled source. */
  analysis: FirmwareFinding[];
  analysisStatus: "idle" | "running" | "ok" | "unavailable";
  /** A line to show in the Code tab (set from a run report); `seq` makes repeats re-trigger. */
  reveal: { line: number; seq: number } | null;
  requestReveal: (line: number) => void;
  analyze: () => Promise<void>;
  load: (design: Design) => Promise<void>;
  setSource: (source: string) => void;
  compile: () => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

export const useFirmware = create<FirmwareState>()((setState, getState) => {
  const persist = () => {
    const s = getState();
    if (!s.designId || !s.board) return;
    const { designId, board, source, artifact } = s;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void set(
        designId,
        { board, source, ...(artifact ? { artifact } : {}), updatedAt: Date.now() },
        db(),
      ).catch(() => undefined);
    }, 300);
  };
  return {
    designId: null,
    board: null,
    source: "",
    artifact: null,
    status: "idle",
    diagnostics: [],
    log: "",
    message: "",
    analysis: [],
    analysisStatus: "idle",
    reveal: null,
    requestReveal: (line) => {
      setState({ reveal: { line, seq: (getState().reveal?.seq ?? 0) + 1 } });
    },
    analyze: async () => {
      const { board, source } = getState();
      if (!board) return;
      setState({ analysisStatus: "running" });
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ board, files: { [SKETCH_FILE]: source } }),
        });
        const parsed = AnalyzeResponse.safeParse(await res.json());
        if (getState().source !== source) return;
        setState(
          parsed.success
            ? { analysis: parsed.data.findings, analysisStatus: "ok" }
            : { analysis: [], analysisStatus: "unavailable" },
        );
      } catch {
        setState({ analysis: [], analysisStatus: "unavailable" });
      }
    },
    load: async (design) => {
      const b = boardOf(design);
      if (getState().designId === design.id && getState().board === (b?.board ?? null)) return;
      if (!b) {
        setState({
          designId: design.id,
          board: null,
          source: "",
          artifact: null,
          status: "idle",
          diagnostics: [],
          log: "",
          message: "",
        });
        return;
      }
      let saved: z.infer<typeof Saved> | undefined;
      try {
        const r = Saved.safeParse(await get(design.id, db()));
        saved = r.success && r.data.board === b.board ? r.data : undefined;
      } catch {
        saved = undefined;
      }
      const source = saved?.source ?? starterFor(b.board);
      const artifact =
        saved?.artifact?.board === b.board
          ? saved.artifact
          : (prebuiltFor(source, b.board) ?? null);
      setState({
        designId: design.id,
        board: b.board,
        source,
        artifact,
        status: artifact ? "ok" : "idle",
        diagnostics: [],
        log: "",
        message: artifact && !saved?.artifact ? "Prebuilt example: ready to run." : "",
      });
    },
    setSource: (source) => {
      const { board } = getState();
      const prebuilt = board ? prebuiltFor(source, board) : undefined;
      setState({
        source,
        artifact: prebuilt ?? null,
        status: prebuilt ? "ok" : "idle",
        message: prebuilt ? "Prebuilt example: ready to run." : "",
        analysis: [],
        analysisStatus: "idle",
      });
      persist();
    },
    compile: async () => {
      const { board, source } = getState();
      if (!board) return;
      setState({ status: "compiling", message: "", diagnostics: [] });
      try {
        const res = await fetch("/api/compile", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ board, files: { [SKETCH_FILE]: source } }),
        });
        const body: unknown = await res.json();
        const parsed = CompileResponse.safeParse(body);
        if (!parsed.success) {
          const err = (body as { error?: string } | null)?.error;
          setState({
            status: "error",
            message: err ?? `The compiler returned ${res.status}.`,
            artifact: null,
          });
          return;
        }
        if (getState().source !== source) return; // edited while compiling
        if (parsed.data.ok) {
          const a = parsed.data.artifact;
          setState({
            status: "ok",
            artifact: a,
            diagnostics: a.warnings,
            log: parsed.data.log,
            message: `Compiled: ${a.sizes.flashBytes} bytes${a.sizes.ramBytes ? `, ${a.sizes.ramBytes} bytes of RAM` : ""}.`,
          });
          void getState().analyze();
        } else
          setState({
            status: "error",
            artifact: null,
            diagnostics: parsed.data.diagnostics,
            log: parsed.data.log,
            message: "Compilation failed.",
          });
        persist();
      } catch {
        setState({ status: "error", message: "Couldn't reach the compiler.", artifact: null });
      }
    },
  };
});

/** Store a sketch for a design before its editor opens (learn-mode lessons). */
export async function saveSketchFor(
  designId: string,
  board: Board,
  source: string,
  artifact: FirmwareArtifact | undefined,
): Promise<void> {
  await set(
    designId,
    { board, source, ...(artifact ? { artifact } : {}), updatedAt: Date.now() },
    db(),
  );
}
