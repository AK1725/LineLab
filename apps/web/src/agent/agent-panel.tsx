"use client";

import type { SideSummary, VerifiedPatch } from "@linelab/agent";
import type { Design, Track } from "@linelab/schema";
import { useState } from "react";
import { useFirmware } from "../firmware/store";
import { useAgent } from "./agent-store";

const SYMPTOMS: [string, string][] = [
  ["oscillates", "Wobbles across the line"],
  ["loses_line_on_turns", "Loses the line on turns"],
  ["too_fast", "Too fast to stay on the line"],
  ["too_slow", "Too slow"],
  ["spins", "Spins in place"],
  ["stops", "Stops"],
  ["wrong_direction", "A wheel turns the wrong way"],
  ["resets", "The board resets"],
  ["other", "Something else"],
];

const TOOL_LABEL: Record<string, string> = {
  get_firmware: "Read the sketch",
  get_design_summary: "Looked at the robot",
  get_netlist: "Looked at the wiring",
  get_run_report: "Read the run report",
  get_trace_window: "Looked at recorded signals",
  static_analysis: "Ran static analysis",
  compile: "Compiled a version",
  simulate: "Simulated a version",
  search_fix_knowledge: "Searched confirmed fixes",
  propose_patch: "Submitted a fix to the gate",
};

function Diff({ diff }: { diff: string }) {
  return (
    <pre
      className="max-h-80 overflow-auto rounded border border-border bg-bg p-2 text-xs leading-5"
      data-testid="agent-diff"
    >
      {diff.split("\n").map((l, i) => (
        <div
          key={i}
          className={
            l.startsWith("+") && !l.startsWith("+++")
              ? "bg-green-500/15 text-green-800 dark:text-green-300"
              : l.startsWith("-") && !l.startsWith("---")
                ? "bg-red-500/15 text-red-800 dark:text-red-300"
                : l.startsWith("@@")
                  ? "text-muted"
                  : ""
          }
        >
          {l || " "}
        </div>
      ))}
    </pre>
  );
}

function BeforeAfter({ before, after }: { before: SideSummary; after: SideSummary }) {
  const rows: [string, string, string][] = [
    [
      "Seeds finished",
      `${String(Math.round(before.robustness * 100))} %`,
      `${String(Math.round(after.robustness * 100))} %`,
    ],
    [
      "Completion",
      `${before.meanCompletionPct.toFixed(0)} %`,
      `${after.meanCompletionPct.toFixed(0)} %`,
    ],
    ["Error events", String(before.errorEvents), String(after.errorEvents)],
    ["Warning events", String(before.warningEvents), String(after.warningEvents)],
    ["Static-analysis findings", String(before.lintFindings), String(after.lintFindings)],
    [
      "Mean lap time",
      before.meanLapTimeMs !== undefined ? `${(before.meanLapTimeMs / 1000).toFixed(2)} s` : "—",
      after.meanLapTimeMs !== undefined ? `${(after.meanLapTimeMs / 1000).toFixed(2)} s` : "—",
    ],
    [
      "Mean lateral error",
      `${before.meanLateralErrorMm.toFixed(1)} mm`,
      `${after.meanLateralErrorMm.toFixed(1)} mm`,
    ],
  ];
  return (
    <table className="w-full text-sm tabular-nums" data-testid="agent-before-after">
      <thead>
        <tr className="text-xs text-muted">
          <th className="text-left font-normal">Measured on {String(before.seeds.length)} seeds</th>
          <th className="text-right font-normal">Before</th>
          <th className="text-right font-normal">After</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, b, a]) => (
          <tr key={k} className="border-t border-border">
            <td className="py-0.5">{k}</td>
            <td className="text-right">{b}</td>
            <td className={`text-right ${a !== b ? "font-medium" : ""}`}>{a}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FeedbackForm() {
  const feedback = useAgent((s) => s.feedback);
  const [worked, setWorked] = useState<boolean | null>(null);
  const [where, setWhere] = useState("");
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [share, setShare] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  return (
    <form
      className="space-y-2 rounded-md border border-border p-3"
      data-testid="agent-feedback"
      onSubmit={(e) => {
        e.preventDefault();
        if (worked === null) return;
        void feedback({
          worked,
          symptoms,
          share: worked && share,
          ...(where ? { where } : {}),
          ...(notes ? { notes } : {}),
        }).then((r) => {
          setSent(
            r === "stored"
              ? "Thanks! This fix is now a confirmed case the debugger can learn from."
              : r === "kept"
                ? "Great, glad it works. Nothing was shared."
                : r === "restarted"
                  ? "Starting another round with your observations…"
                  : null,
          );
        });
      }}
    >
      <h4 className="font-medium">Test it on your real track</h4>
      <p className="text-xs text-muted">
        Flash the fixed sketch to your robot, try it, and tell the debugger what happened. If it
        didn&apos;t work, your observations start another round.
      </p>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="worked"
            checked={worked === true}
            onChange={() => {
              setWorked(true);
            }}
          />{" "}
          It worked
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="worked"
            checked={worked === false}
            onChange={() => {
              setWorked(false);
            }}
          />{" "}
          It didn&apos;t work
        </label>
      </div>
      {worked === true && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={share}
            onChange={(e) => {
              setShare(e.target.checked);
            }}
          />
          <span>
            Share this fix to help others{" "}
            <span className="text-muted">
              (the diff, the diagnosis and your board/driver/sensor names; not your sketch, not who
              you are)
            </span>
          </span>
        </label>
      )}
      {worked === false && (
        <>
          <label className="block text-sm">
            <span className="text-muted">Where on the track did it fail?</span>
            <input
              value={where}
              onChange={(e) => {
                setWhere(e.target.value);
              }}
              placeholder="e.g. the second sharp left turn"
              className="mt-1 w-full rounded border border-border bg-bg px-2 py-1"
            />
          </label>
          <fieldset className="grid grid-cols-2 gap-1 text-sm">
            <legend className="text-muted">What did you see?</legend>
            {SYMPTOMS.map(([id, label]) => (
              <label key={id} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={symptoms.includes(id)}
                  onChange={(e) => {
                    setSymptoms(
                      e.target.checked ? [...symptoms, id] : symptoms.filter((s) => s !== id),
                    );
                  }}
                />{" "}
                {label}
              </label>
            ))}
          </fieldset>
          <label className="block text-sm">
            <span className="text-muted">Anything else (optional)</span>
            <textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
              }}
              rows={2}
              className="mt-1 w-full rounded border border-border bg-bg px-2 py-1"
            />
          </label>
        </>
      )}
      <button
        type="submit"
        disabled={worked === null}
        className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-white disabled:opacity-40 dark:text-black"
      >
        Send
      </button>
      {sent && (
        <p role="status" className="text-sm text-accent">
          {sent}
        </p>
      )}
    </form>
  );
}

function VerifiedFix({ v, onUse }: { v: VerifiedPatch; onUse: () => void }) {
  return (
    <section
      className="space-y-3 rounded-md border border-accent/50 bg-accent/5 p-3"
      data-testid="agent-verified"
    >
      <h4 className="font-medium text-accent">Verified fix</h4>
      <p className="text-xs text-muted">
        LineLab compiled this change and ran it on your run&apos;s seed plus fresh ones:{" "}
        {v.improvements.join("; ")}, with nothing getting worse.
      </p>
      <BeforeAfter before={v.before} after={v.after} />
      <p className="text-sm">{v.rationale}</p>
      <Diff diff={v.diff} />
      <details>
        <summary className="cursor-pointer text-sm">Full corrected file</summary>
        <pre
          className="mt-1 max-h-96 overflow-auto rounded border border-border bg-bg p-2 text-xs"
          data-testid="agent-full-file"
        >
          {v.fullFile}
        </pre>
      </details>
      <button
        type="button"
        onClick={onUse}
        className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white dark:text-black"
      >
        Use this version and re-run
      </button>
    </section>
  );
}

export default function AgentPanel({
  design,
  track,
  seed,
  onRerun,
}: {
  design: Design;
  track: Track;
  seed: number;
  onRerun: () => void;
}) {
  const a = useAgent();
  const [request, setRequest] = useState("");
  const running = a.status === "starting" || a.status === "running";
  const STATUS_TEXT = {
    fixed: "Fixed",
    not_fixed: "No verified fix found",
    refused: "The model declined",
    budget_exhausted: "Stopped: token budget used",
    error: "Stopped by an error",
  } as const;
  return (
    <section
      aria-labelledby="agent-heading"
      className="space-y-3 rounded-lg border border-border p-3"
      data-testid="agent-panel"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="agent-heading" className="font-semibold">
          Debug with AI
        </h3>
        {a.round > 1 && <span className="text-xs text-muted">round {String(a.round)}</span>}
        {a.result && (
          <span
            data-testid="agent-status"
            data-status={a.result.status}
            className={`rounded-full px-2 py-0.5 text-xs ${a.result.status === "fixed" ? "bg-accent text-white dark:text-black" : "bg-amber-500/15 text-amber-700"}`}
          >
            {STATUS_TEXT[a.result.status]}
            {a.result.model === "scripted" ? " (scripted demo transcript)" : ""}
          </span>
        )}
      </div>
      {a.status === "idle" || a.status === "error" ? (
        <div className="space-y-2">
          <p className="text-sm text-muted">
            Claude reads the run report and your sketch, tests ideas in the simulator, and proposes
            a fix. A fix is shown only after LineLab has compiled it and verified it on your seed
            and fresh ones.
          </p>
          <textarea
            value={request}
            onChange={(e) => {
              setRequest(e.target.value);
            }}
            rows={2}
            placeholder="Optional: what should it focus on? (e.g. “it wobbles on straights”)"
            className="w-full rounded border border-border bg-bg px-2 py-1 text-sm"
            aria-label="What should the debugger focus on?"
          />
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">Use your own Anthropic API key</summary>
            <input
              type="password"
              value={a.apiKey}
              onChange={(e) => {
                a.setApiKey(e.target.value);
              }}
              placeholder="sk-ant-…"
              autoComplete="off"
              className="mt-1 w-full rounded border border-border bg-bg px-2 py-1"
              aria-label="Anthropic API key"
            />
            <p className="mt-1 text-xs text-muted">Sent with this request only; never stored.</p>
          </details>
          <button
            type="button"
            data-testid="agent-start"
            onClick={() => {
              void a.start({
                design,
                track,
                source: useFirmware.getState().source,
                seeds: [seed],
                request,
              });
            }}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white dark:text-black"
          >
            Find and fix the problem
          </button>
          {a.error && (
            <p role="alert" className="text-sm text-red-600">
              {a.error}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {running && (
            <p className="text-sm text-muted" role="status">
              Working… this can take a few minutes: every idea is compiled and simulated.
            </p>
          )}
          {a.thinking && (
            <details>
              <summary className="cursor-pointer text-xs text-muted">Reasoning summary</summary>
              <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{a.thinking}</p>
            </details>
          )}
          {a.activity.length > 0 && (
            <ol className="space-y-0.5 text-xs" data-testid="agent-activity">
              {a.activity.map((x) => (
                <li key={x.id} className={x.isError ? "text-red-600" : "text-muted"}>
                  {TOOL_LABEL[x.name] ?? x.name}
                  {x.summary ? `: ${x.summary}` : "…"}
                </li>
              ))}
            </ol>
          )}
          {a.attempts.filter((t) => !t.accepted).length > 0 && (
            <div className="text-xs">
              <h4 className="font-medium">Fixes the gate rejected (not shown)</h4>
              <ul className="list-disc pl-4 text-muted" data-testid="agent-rejected">
                {a.attempts
                  .filter((t) => !t.accepted)
                  .map((t) => (
                    <li key={t.n}>
                      Attempt {String(t.n)}: {t.reasons.join(" ")}
                    </li>
                  ))}
              </ul>
            </div>
          )}
          {(a.result?.diagnosis ?? a.text) && (
            <div className="whitespace-pre-wrap text-sm" data-testid="agent-diagnosis">
              {a.result ? a.result.diagnosis : a.text.replace(/```[\s\S]*?(```|$)/g, "")}
            </div>
          )}
          {a.result?.note && <p className="text-xs text-amber-700">{a.result.note}</p>}
          {a.verified && (
            <VerifiedFix
              v={a.verified}
              onUse={() => {
                const v = a.verified;
                if (!v) return;
                useFirmware.getState().setSource(v.fullFile);
                useFirmware.setState({
                  artifact: v.artifact,
                  status: "ok",
                  message: "Verified fix from the AI debugger.",
                });
                onRerun();
              }}
            />
          )}
          {a.result && a.verified && <FeedbackForm />}
          {a.result && (
            <p className="text-xs text-muted">
              {String(a.result.usage.turns)} model turns,{" "}
              {String(
                a.result.usage.inputTokens +
                  a.result.usage.outputTokens +
                  a.result.usage.cacheReadTokens +
                  a.result.usage.cacheCreationTokens,
              )}{" "}
              tokens ({String(a.result.usage.cacheReadTokens)} from cache).{" "}
              <button type="button" onClick={a.reset} className="text-accent hover:underline">
                Start over
              </button>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
