"use client";

import type { FirmwareFinding, SimEvent } from "@linelab/schema";
import { download } from "../editor/files";
import { useEditor } from "../editor/store";
import { useFirmware } from "../firmware/store";
import type { CompletedRun } from "./run-store";
import { useRun } from "./run-store";

const DOT = { error: "bg-red-500", warning: "bg-amber-500", info: "bg-slate-400" } as const;

/** Open the Code tab at a line of the sketch. */
function openLine(line: number) {
  useEditor.getState().setView("code");
  useFirmware.getState().requestReveal(line);
}

function SourceLink({ line, exact }: { line: number; exact?: boolean | undefined }) {
  return (
    <button
      type="button"
      onClick={() => {
        openLine(line);
      }}
      className="text-xs text-accent hover:underline"
      title={exact ? "Measured from the program counter" : "Found by matching the sketch; check it"}
      data-testid="source-link"
    >
      line {line}
      {exact ? "" : " (likely)"}
    </button>
  );
}

function EventItem({ e }: { e: SimEvent }) {
  const seek = useRun((s) => s.seek);
  const setPlaying = useRun((s) => s.setPlaying);
  return (
    <li className="space-y-0.5" data-type={e.type} data-severity={e.severity}>
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${DOT[e.severity]}`}
          aria-label={e.severity}
        />
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            seek(e.tMs);
          }}
          className="text-left hover:text-accent"
        >
          <span className="tabular-nums text-muted">{(e.tMs / 1000).toFixed(2)} s</span>{" "}
          <span className="font-medium">{e.type.replace(/_/g, " ")}</span>
        </button>
        {e.sourceLoc && <SourceLink line={e.sourceLoc.line} exact={e.sourceLoc.exact} />}
      </div>
      {e.message && e.type !== "lap_complete" && e.type !== "line_reacquired" && (
        <p className="pl-4 text-xs text-muted">{e.message}</p>
      )}
    </li>
  );
}

export function ReportPanel({ run }: { run: CompletedRun }) {
  const s = run.summary;
  const problems = s.events.filter((e) => e.severity !== "info");
  const info = s.events.filter((e) => e.severity === "info");
  return (
    <div className="space-y-3" data-testid="run-report">
      <p className="text-xs" data-testid="report-counts">
        <span className={s.counts.errors > 0 ? "font-medium text-red-600" : "text-muted"}>
          {s.counts.errors} error(s)
        </span>
        ,{" "}
        <span className={s.counts.warnings > 0 ? "font-medium text-amber-600" : "text-muted"}>
          {s.counts.warnings} warning(s)
        </span>
      </p>
      {s.events.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase text-muted">Events</h3>
          <ul className="mt-1 space-y-2" data-testid="run-events">
            {[...problems, ...info].map((e, i) => (
              <EventItem key={i} e={e} />
            ))}
          </ul>
        </div>
      )}
      {s.lint.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase text-muted">Static analysis</h3>
          <ul className="mt-1 space-y-2" data-testid="report-lint">
            {s.lint.map((f, i) => (
              <li key={i} className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${DOT[f.severity]}`}
                    aria-label={f.severity}
                  />
                  <span>{f.message}</span>
                </div>
                <div className="pl-4">
                  <SourceLink line={f.line} exact />
                  <span className="ml-2 text-[11px] text-muted">{f.ruleId}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          download(
            `linelab-run-${run.track.id}-seed${String(s.seed)}.md`,
            reportMarkdown(run),
            "text/markdown",
          );
        }}
        className="rounded-md border border-border px-2 py-1 text-xs hover:border-accent"
      >
        Download report (Markdown)
      </button>
    </div>
  );
}

/** A plain-text report to share or paste into an issue. */
export function reportMarkdown(run: CompletedRun): string {
  const s = run.summary;
  const m = s.metrics;
  const ev = (e: SimEvent) =>
    `- **${e.type.replace(/_/g, " ")}** (${e.severity}) at ${(e.tMs / 1000).toFixed(2)} s${e.sourceLoc ? `, ${e.sourceLoc.file}:${String(e.sourceLoc.line)}${e.sourceLoc.exact ? "" : " (likely)"}` : ""}${e.message ? `: ${e.message}` : ""}`;
  const lint = (f: FirmwareFinding) =>
    `- **${f.ruleId}** (${f.severity}) ${f.file}:${String(f.line)}: ${f.message}`;
  return [
    `# LineLab run report: ${run.track.name}`,
    "",
    `- Robot: ${run.design.name}`,
    `- Controller: ${s.controller === "firmware" ? `firmware (${s.firmware?.tier === "hal" ? "approximate HAL" : "emulated"})` : "reference PID"}`,
    `- Seed ${String(s.seed)}, trace ${s.hash}`,
    `- Outcome: **${s.outcome.replace("_", " ")}**, ${m.completionPct.toFixed(0)} % complete${m.lapTimeMs !== undefined ? `, lap ${(m.lapTimeMs / 1000).toFixed(2)} s` : ""}`,
    `- Lateral error: mean ${m.meanLateralErrorMm.toFixed(1)} mm, max ${m.maxLateralErrorMm.toFixed(0)} mm`,
    ...(run.runs.length > 1
      ? [
          `- Monte Carlo robustness: ${String(Math.round(run.robustness * 100))} % of ${String(run.runs.length)} seeds`,
        ]
      : []),
    "",
    "## Events",
    "",
    ...(s.events.length > 0
      ? s.events.filter((e) => e.type !== "line_reacquired").map(ev)
      : ["None."]),
    "",
    ...(s.controller === "firmware"
      ? ["## Static analysis", "", ...(s.lint.length > 0 ? s.lint.map(lint) : ["No findings."]), ""]
      : []),
  ].join("\n");
}
