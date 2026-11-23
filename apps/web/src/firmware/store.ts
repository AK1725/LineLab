"use client";

import { getComponent } from "@linelab/component-db";
import { EMULATED_BOARDS } from "@linelab/firmware-runtime";
import {
  Board,
  CompileResponse,
  FirmwareArtifact,
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
          body: JSON.stringify({ board, files: { "sketch.ino": source } }),
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
