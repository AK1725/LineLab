"use client";

import { runRules } from "@linelab/rules-engine";
import type { Finding } from "@linelab/schema";
import { useMemo } from "react";
import { chassisOf, lookup, useDesign, useEditor } from "./store";

const STYLE = {
  error: { icon: "●", cls: "text-red-600", label: "Errors" },
  warning: { icon: "▲", cls: "text-amber-600", label: "Warnings" },
  tip: { icon: "◆", cls: "text-sky-600", label: "Tips" },
} as const;

export function useFindings(): Finding[] {
  const design = useDesign();
  return useMemo(() => {
    const chassis = chassisOf(design);
    return chassis ? runRules(design, chassis, lookup) : [];
  }, [design]);
}

export default function Checks() {
  const findings = useFindings();
  const st = useEditor.getState();
  const counts = { error: 0, warning: 0, tip: 0 };
  for (const f of findings) counts[f.severity]++;

  return (
    <section aria-labelledby="checks-heading" data-testid="checks">
      <h2 id="checks-heading" className="mb-1 flex items-center gap-2 text-sm font-semibold">
        Checks
        <span data-testid="check-counts" className="font-normal text-muted">
          <span className={STYLE.error.cls}>{counts.error}</span> ·{" "}
          <span className={STYLE.warning.cls}>{counts.warning}</span> ·{" "}
          <span className={STYLE.tip.cls}>{counts.tip}</span>
        </span>
      </h2>
      {findings.length === 0 ? (
        <p className="text-sm text-muted">No problems found.</p>
      ) : (
        <ul className="space-y-1.5">
          {findings.map((f, i) => {
            const s = STYLE[f.severity];
            const parts = [
              ...new Set(
                f.affected
                  .filter((a) => a.kind === "placement" || a.kind === "pin")
                  .map((a) => a.ref.split("/")[0] ?? a.ref),
              ),
            ];
            return (
              <li
                key={`${f.id}-${i}`}
                data-testid="finding"
                data-rule={f.id}
                data-severity={f.severity}
                className="rounded-md border border-border p-2 text-sm"
              >
                <div className="flex gap-2">
                  <span aria-label={f.severity} className={`${s.cls} shrink-0`}>
                    {s.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p>{f.message}</p>
                    <details className="mt-0.5">
                      <summary className="cursor-pointer text-xs text-muted">
                        Why it matters
                      </summary>
                      <p className="mt-1 text-xs text-muted">{f.explanation}</p>
                    </details>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {parts.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            st.select(parts);
                          }}
                          className="text-xs text-accent hover:underline"
                        >
                          Show
                        </button>
                      )}
                      {f.fix && (
                        <button
                          type="button"
                          onClick={() => {
                            if (f.fix) st.applyCommands(f.fix.operations);
                          }}
                          className="rounded border border-accent px-1.5 text-xs font-medium text-accent hover:bg-accent/10"
                        >
                          Fix: {f.fix.label}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
