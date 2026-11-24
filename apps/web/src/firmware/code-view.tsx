"use client";

import dynamic from "next/dynamic";
import { getComponent } from "@linelab/component-db";
import { lintSketch } from "@linelab/firmware-lint";
import { resolveWiring } from "@linelab/firmware-runtime";
import { pinContextFor } from "@linelab/run-report";
import { buildRobotModel } from "@linelab/sim-core";
import { useDeferredValue, useEffect, useMemo } from "react";
import { chassisOf } from "../editor/store";
import { useDesign } from "../editor/store";
import { EXAMPLES } from "./examples";
import { boardOf, SKETCH_FILE, useFirmware } from "./store";

const CodeEditor = dynamic(() => import("./code-editor"), {
  ssr: false,
  loading: () => <p className="p-4 text-sm text-muted">Loading editor…</p>,
});

declare global {
  interface Window {
    __linelabFirmware?: typeof useFirmware;
  }
}

export function TierBadge({ tier }: { tier: "emulated" | "hal" }) {
  return tier === "emulated" ? (
    <span
      className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent"
      title="The compiled binary runs on an emulated CPU, cycle by cycle (avr8js)."
    >
      Emulated · cycle-accurate
    </span>
  ) : (
    <span
      className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400"
      title="This board's sketch is compiled to WebAssembly against LineLab's simulated Arduino core. Timing is approximate: each call costs a fixed time and there are no timers or interrupts."
      data-testid="approximate-badge"
    >
      Approximate (HAL)
    </span>
  );
}

export default function CodeView() {
  const design = useDesign();
  const fw = useFirmware();
  const reveal = useFirmware((s) => s.reveal);
  const setReveal = (line: number) => {
    useFirmware.getState().requestReveal(line);
  };
  const b = boardOf(design);
  const pins = useMemo(() => {
    try {
      const chassis = chassisOf(design);
      if (!chassis) return undefined;
      return pinContextFor(
        resolveWiring(design, getComponent, buildRobotModel(design, chassis, getComponent)),
      );
    } catch {
      return undefined; // incomplete design: lint without wiring checks
    }
  }, [design]);
  const lint = useDeferredValue(
    useMemo(
      () => lintSketch(fw.source, { file: SKETCH_FILE, ...(pins ? { pins } : {}) }),
      [fw.source, pins],
    ),
  );
  const findings = useMemo(
    () => [...lint, ...fw.analysis].sort((x, y) => x.line - y.line),
    [lint, fw.analysis],
  );
  const markers = useMemo(
    () => [
      ...fw.diagnostics,
      ...findings.map((f) => ({
        file: f.file,
        line: f.line,
        column: f.column ?? 1,
        severity: f.severity === "info" ? ("note" as const) : f.severity,
        message: `${f.message} (${f.ruleId})`,
      })),
    ],
    [fw.diagnostics, findings],
  );
  useEffect(() => {
    void useFirmware.getState().load(design);
  }, [design]);
  useEffect(() => {
    window.__linelabFirmware = useFirmware; // test & debugging hook
  }, []);

  if (!b) {
    return (
      <p className="p-6 text-sm text-muted">
        Add a microcontroller board to write firmware for it.
      </p>
    );
  }
  const examples = EXAMPLES.filter(
    (e) =>
      e.board === b.board ||
      (b.tier === "hal" && e.board.startsWith("esp32") && b.board.startsWith("esp32")),
  );
  const errors = fw.diagnostics.filter((d) => d.severity === "error");
  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[1fr_19rem]">
      <div className="flex min-h-0 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2 text-sm">
          <span className="font-medium">{b.name}</span>
          <TierBadge tier={b.tier} />
          {examples.length > 0 && (
            <label className="flex items-center gap-1">
              <span className="text-muted">Example</span>
              <select
                aria-label="Load example"
                value=""
                onChange={(e) => {
                  const ex = EXAMPLES.find((x) => x.id === e.target.value);
                  if (ex && (fw.source === "" || confirm(`Replace your sketch with “${ex.name}”?`)))
                    fw.setSource(ex.source);
                }}
                className="rounded-md border border-border bg-bg px-1 py-1"
              >
                <option value="">Choose…</option>
                {examples.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={() => {
              void fw.compile();
            }}
            disabled={fw.status === "compiling"}
            className="ml-auto rounded-lg bg-accent px-4 py-1.5 font-medium text-white disabled:opacity-50 dark:text-black"
          >
            {fw.status === "compiling" ? "Compiling…" : "Compile"}
          </button>
        </div>
        <div className="min-h-[320px] flex-1" data-testid="code-editor">
          <CodeEditor
            value={fw.source}
            onChange={(v) => {
              fw.setSource(v);
            }}
            diagnostics={markers}
            reveal={reveal}
          />
        </div>
      </div>
      <aside
        className="min-h-0 space-y-3 overflow-y-auto border-t border-border p-3 text-sm lg:border-l lg:border-t-0"
        aria-label="Build output"
      >
        <h2 className="font-semibold">Build</h2>
        <p
          role="status"
          data-testid="build-status"
          data-status={fw.status}
          className={
            fw.status === "error" ? "text-red-600" : fw.artifact ? "text-accent" : "text-muted"
          }
        >
          {fw.message || (fw.artifact ? "Ready to run." : "Not compiled yet.")}
        </p>
        {errors.length > 0 && (
          <ul className="space-y-1" data-testid="diagnostics">
            {errors.map((d, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => {
                    setReveal(d.line);
                  }}
                  className="text-left text-red-600 hover:underline"
                >
                  {d.file}:{d.line}: {d.message}
                </button>
              </li>
            ))}
          </ul>
        )}
        {fw.diagnostics.some((d) => d.severity === "warning") && (
          <details>
            <summary className="cursor-pointer text-amber-600">Warnings</summary>
            <ul className="mt-1 space-y-1 text-xs">
              {fw.diagnostics
                .filter((d) => d.severity === "warning")
                .map((d, i) => (
                  <li key={i}>
                    {d.file}:{d.line}: {d.message}
                  </li>
                ))}
            </ul>
          </details>
        )}
        <section aria-labelledby="analysis-heading">
          <h2 id="analysis-heading" className="font-semibold">
            Static analysis
          </h2>
          <p className="text-xs text-muted">
            LineLab&apos;s line-follower rules check as you type
            {fw.analysisStatus === "ok"
              ? "; cppcheck and clang-tidy ran on the last build."
              : fw.analysisStatus === "running"
                ? "; cppcheck and clang-tidy are running…"
                : fw.analysisStatus === "unavailable"
                  ? "; cppcheck and clang-tidy need the compiler service."
                  : "; cppcheck and clang-tidy run when you compile."}
          </p>
          {findings.length === 0 ? (
            <p className="mt-1 text-accent" data-testid="analysis-clean">
              No findings.
            </p>
          ) : (
            <ul className="mt-1 space-y-2" data-testid="analysis">
              {findings.map((f, i) => (
                <li key={`${f.ruleId}:${String(f.line)}:${String(i)}`} data-rule={f.ruleId}>
                  <button
                    type="button"
                    onClick={() => {
                      setReveal(f.line);
                    }}
                    className="text-left hover:underline"
                  >
                    <span
                      className={
                        f.severity === "error"
                          ? "text-red-600"
                          : f.severity === "warning"
                            ? "text-amber-600"
                            : "text-muted"
                      }
                    >
                      Line {f.line}: {f.message}
                    </span>
                  </button>
                  {f.explanation && <p className="text-xs text-muted">{f.explanation}</p>}
                  <p className="text-[11px] text-muted">
                    {f.tool === "linelab"
                      ? f.ruleId
                      : `${f.tool}: ${f.ruleId.replace(/^[a-z-]+\./, "")}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
        {fw.log && (
          <details>
            <summary className="cursor-pointer text-muted">Compiler log</summary>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-bg p-2 text-xs">
              {fw.log}
            </pre>
          </details>
        )}
        <p className="text-xs text-muted">
          {b.tier === "emulated"
            ? "Your sketch is compiled with arduino-cli and the real binary runs on an emulated ATmega328P in the Run tab."
            : "Your sketch is compiled against LineLab's simulated Arduino core. Interrupts, hardware timers and some libraries aren't available; timing is approximate."}{" "}
          Compiling happens in a sandbox with no network access.
        </p>
      </aside>
    </div>
  );
}
