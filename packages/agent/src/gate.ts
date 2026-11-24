import type { OkEvaluation, Evaluation, SeedResult } from "./workbench.js";

export interface SideSummary {
  robustness: number;
  meanCompletionPct: number;
  errorEvents: number;
  warningEvents: number;
  lintFindings: number;
  meanLapTimeMs: number | undefined;
  meanLateralErrorMm: number;
  seeds: SeedResult[];
}

export interface GateResult {
  accepted: boolean;
  /** Why it was rejected (empty when accepted). */
  reasons: string[];
  /** What got better (for the user and the model). */
  improvements: string[];
  before: SideSummary;
  after: SideSummary | undefined;
}

export function summarize(e: OkEvaluation): SideSummary {
  const done = e.seeds.filter((s) => s.lapTimeMs !== undefined);
  return {
    robustness: e.robustness,
    meanCompletionPct: e.meanCompletionPct,
    errorEvents: e.seeds.reduce((a, s) => a + s.errors.length, 0),
    warningEvents: e.seeds.reduce((a, s) => a + s.warnings.length, 0),
    lintFindings: e.lint.filter((f) => f.severity !== "info").length,
    meanLapTimeMs:
      done.length > 0 ? done.reduce((a, s) => a + (s.lapTimeMs ?? 0), 0) / done.length : undefined,
    meanLateralErrorMm: e.seeds.reduce((a, s) => a + s.meanLateralErrorMm, 0) / e.seeds.length,
    seeds: e.seeds,
  };
}

/**
 * The verification gate (BLUEPRINT §5.8), enforced in code: a patch reaches the user only if it
 * compiles, keeps robustness and completion at least as high on the user's seeds plus fresh
 * seeds, introduces no new error-level event on any seed, adds no lint findings, and measurably
 * improves something. The model can argue; only this function decides.
 */
export function verifyPatch(before: OkEvaluation, after: Evaluation): GateResult {
  const b = summarize(before);
  if (!after.ok) {
    const first = after.diagnostics.find((d) => d.severity === "error");
    return {
      accepted: false,
      reasons: [
        `It doesn't compile${first ? `: ${first.file}:${String(first.line)}: ${first.message}` : "."}`,
      ],
      improvements: [],
      before: b,
      after: undefined,
    };
  }
  const a = summarize(after);
  const reasons: string[] = [];
  const EPS = 1e-9;
  if (a.robustness + EPS < b.robustness)
    reasons.push(`Robustness drops from ${pct(b.robustness)} to ${pct(a.robustness)} of seeds.`);
  if (a.meanCompletionPct + EPS < b.meanCompletionPct)
    reasons.push(
      `Completion drops from ${b.meanCompletionPct.toFixed(0)} % to ${a.meanCompletionPct.toFixed(0)} %.`,
    );
  for (const s of a.seeds) {
    const old = new Set(before.seeds.find((x) => x.seed === s.seed)?.errors ?? []);
    const fresh = s.errors.filter((e) => !old.has(e));
    if (fresh.length > 0)
      reasons.push(`New error on seed ${String(s.seed)}: ${fresh.join(", ").replace(/_/g, " ")}.`);
  }
  const oldRules = new Set(before.lint.map((f) => f.ruleId));
  const newRules = [
    ...new Set(
      after.lint
        .filter((f) => f.severity !== "info" && !oldRules.has(f.ruleId))
        .map((f) => f.ruleId),
    ),
  ];
  if (newRules.length > 0) reasons.push(`New static-analysis findings: ${newRules.join(", ")}.`);

  const improvements: string[] = [];
  if (a.robustness > b.robustness + EPS)
    improvements.push(`robustness ${pct(b.robustness)} → ${pct(a.robustness)}`);
  if (a.meanCompletionPct > b.meanCompletionPct + 0.5)
    improvements.push(
      `completion ${b.meanCompletionPct.toFixed(0)} % → ${a.meanCompletionPct.toFixed(0)} %`,
    );
  if (a.errorEvents < b.errorEvents)
    improvements.push(`error events ${String(b.errorEvents)} → ${String(a.errorEvents)}`);
  if (a.warningEvents < b.warningEvents)
    improvements.push(`warning events ${String(b.warningEvents)} → ${String(a.warningEvents)}`);
  if (a.lintFindings < b.lintFindings)
    improvements.push(
      `static-analysis findings ${String(b.lintFindings)} → ${String(a.lintFindings)}`,
    );
  if (improvements.length === 0 && reasons.length === 0)
    reasons.push("Nothing measurably improved: no fewer failures, events or findings on any seed.");
  return { accepted: reasons.length === 0, reasons, improvements, before: b, after: a };
}

const pct = (x: number) => `${String(Math.round(x * 100))} %`;
