import type { FirmwareArtifact, SimEvent } from "@linelab/schema";
import { z } from "zod";
import { summarize, verifyPatch, type GateResult, type SideSummary } from "./gate.js";
import type { FixKnowledge } from "./knowledge.js";
import type { Tool } from "./model.js";
import { applyUnifiedDiff, makeUnifiedDiff } from "./patch.js";
import type { OkEvaluation, Workbench } from "./workbench.js";

/** A patch that passed the gate: the only kind ever shown to the user. */
export interface VerifiedPatch {
  /** Regenerated from the files, so it is exactly what changes. */
  diff: string;
  fullFile: string;
  rationale: string;
  expectedEffect: string;
  improvements: string[];
  before: SideSummary;
  after: SideSummary;
  /** The compiled firmware, so the user can run it straight away. */
  artifact: FirmwareArtifact;
}

export interface Attempt {
  n: number;
  accepted: boolean;
  reasons: string[];
  improvements: string[];
  rationale: string;
}

/** Mutable state the tools share within one session. */
export interface ToolState {
  workbench: Workbench;
  baseline: OkEvaluation;
  knowledge: FixKnowledge | undefined;
  attempts: Attempt[];
  verified: VerifiedPatch | undefined;
  maxIterations: number;
}

const SIGNALS = [
  "xMm",
  "yMm",
  "headingRad",
  "vMmS",
  "omegaRadS",
  "pwmLeft",
  "pwmRight",
  "batteryV",
  "logicV",
  "lateralMm",
  "progressMm",
  "currentLeftA",
  "currentRightA",
  "lineSeen",
  "distanceMm",
  "sensors",
] as const;

const Empty = z.object({}).strict();
const Code = z.object({ code: z.string().min(1).max(200_000) }).strict();
const Window = z
  .object({
    t_start_ms: z.number().min(0),
    t_end_ms: z.number().min(0),
    signals: z.array(z.enum(SIGNALS)).min(1).max(8),
  })
  .strict();
const Query = z.object({ query: z.string().min(1).max(2000) }).strict();
const Patch = z
  .object({
    unified_diff: z.string().min(1).max(200_000),
    rationale: z.string().min(1).max(4000),
    expected_effect: z.string().min(1).max(2000),
  })
  .strict();

const SCHEMAS = {
  get_firmware: Empty,
  get_design_summary: Empty,
  get_netlist: Empty,
  get_run_report: Empty,
  get_trace_window: Window,
  static_analysis: Code,
  compile: Code,
  simulate: Code,
  search_fix_knowledge: Query,
  propose_patch: Patch,
} as const;
export type ToolName = keyof typeof SCHEMAS;

const obj = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object" as const,
  properties,
  required,
  additionalProperties: false,
});
const code = { code: { type: "string", description: "The complete sketch (.ino file contents)." } };

/** Tool definitions, in a fixed order (the order is part of the cached prefix). */
export const TOOLS: Tool[] = [
  {
    name: "get_firmware",
    description: "The user's current sketch with line numbers (the version patches apply to).",
    input_schema: obj({}, []),
  },
  {
    name: "get_design_summary",
    description:
      "The robot: microcontroller, motor driver, motors, wheels, sensors, battery, and which microcontroller pins drive each motor-driver input and read each sensor.",
    input_schema: obj({}, []),
  },
  {
    name: "get_netlist",
    description: "Every net in the wiring: which part pins are connected together.",
    input_schema: obj({}, []),
  },
  {
    name: "get_run_report",
    description:
      "The run report for the current sketch: outcome and metrics per seed, detected events with times and source lines, static-analysis findings.",
    input_schema: obj({}, []),
  },
  {
    name: "get_trace_window",
    description:
      "Recorded signals from the user's run (first seed) between two times, as CSV, at most 60 rows. lateralMm > 0 means the line is to the right of the sensors; pwm is signed duty −1..1; lineSeen counts sensors over the line; sensors gives the raw readings.",
    input_schema: obj(
      {
        t_start_ms: { type: "number" },
        t_end_ms: { type: "number" },
        signals: { type: "array", items: { type: "string", enum: [...SIGNALS] } },
      },
      ["t_start_ms", "t_end_ms", "signals"],
    ),
  },
  {
    name: "static_analysis",
    description:
      "LineLab's line-follower lint rules on a version of the sketch (pins are checked against the wiring).",
    input_schema: obj(code, ["code"]),
  },
  {
    name: "compile",
    description:
      "Compile a version of the sketch for the user's board. Returns errors with lines, or the program size.",
    input_schema: obj(code, ["code"]),
  },
  {
    name: "simulate",
    description:
      "Compile and run a version of the sketch on the user's track and seeds plus fresh seeds. Returns outcome, completion, lap time and error/warning events per seed.",
    input_schema: obj(code, ["code"]),
  },
  {
    name: "search_fix_knowledge",
    description:
      "Search fixes that other users confirmed on real robots. Returns the closest cases (may be none).",
    input_schema: obj({ query: { type: "string" } }, ["query"]),
  },
  {
    name: "propose_patch",
    description:
      "Submit a fix as a unified diff against the sketch from the first message (@@ hunk headers, exact context lines). LineLab applies it, compiles it, and runs it on the user's seeds plus fresh seeds. It is accepted only if robustness and completion don't drop, no new error appears, no new lint finding appears, and something measurably improves. Returns ACCEPTED with the measurements, or REJECTED with reasons.",
    input_schema: obj(
      {
        unified_diff: { type: "string" },
        rationale: { type: "string", description: "Why this fixes the cause, for the user." },
        expected_effect: { type: "string", description: "What should change in the run." },
      },
      ["unified_diff", "rationale", "expected_effect"],
    ),
  },
].map((t) => ({ ...t, strict: true, eager_input_streaming: true }));

const evText = (e: SimEvent) =>
  `- ${(e.tMs / 1000).toFixed(2)} s ${e.type} (${e.severity})${e.sourceLoc ? ` at line ${String(e.sourceLoc.line)}${e.sourceLoc.exact ? "" : " (likely)"}` : ""}: ${e.message ?? JSON.stringify(e.data)}`;

/** The run report as text for the model. */
export function reportText(ev: OkEvaluation): string {
  const seeds = ev.seeds.map(
    (s) =>
      `- seed ${String(s.seed)}: ${s.outcome}, ${s.completionPct.toFixed(0)} %${s.lapTimeMs !== undefined ? `, lap ${(s.lapTimeMs / 1000).toFixed(2)} s` : ""}, mean error ${s.meanLateralErrorMm.toFixed(1)} mm${s.errors.length ? `, errors: ${s.errors.join(", ")}` : ""}${s.warnings.length ? `, warnings: ${s.warnings.join(", ")}` : ""}`,
  );
  const m = ev.report.metrics;
  return [
    `Seed 0 (the user's run): ${ev.report.outcome}, ${m.completionPct.toFixed(0)} % complete${m.lapTimeMs !== undefined ? `, lap ${(m.lapTimeMs / 1000).toFixed(2)} s` : ""}, mean/max lateral error ${m.meanLateralErrorMm.toFixed(1)}/${m.maxLateralErrorMm.toFixed(0)} mm, oscillation ${(m.oscillationIndex ?? 0).toFixed(2)} Hz${m.loopFrequencyHz ? `, control loop ${m.loopFrequencyHz.toFixed(0)} Hz` : ""}.`,
    `Robustness: ${String(Math.round(ev.robustness * 100))} % of ${String(ev.seeds.length)} seeds finished.`,
    ...seeds,
    "",
    "Events (seed 0):",
    ...ev.report.events
      .filter((e) => e.type !== "line_reacquired")
      .map(evText)
      .slice(0, 25),
    "",
    "Static analysis:",
    ...(ev.lint.length > 0
      ? ev.lint.map((f) => `- line ${String(f.line)} ${f.ruleId} (${f.severity}): ${f.message}`)
      : ["- no findings"]),
    ...(ev.serial ? ["", "Serial output (first 600 characters):", ev.serial.slice(0, 600)] : []),
  ].join("\n");
}

function designText(wb: Workbench): string {
  const { design, lookup } = wb.opts;
  const parts = design.placements.map(
    (p) => `- ${p.instanceId}: ${lookup(p.componentId)?.name ?? p.componentId}`,
  );
  const w = wb.wiring;
  const motors = w.motors.map((m) => {
    const ins = Object.entries(m.inputs).map(
      ([pin, s]) =>
        `${pin}=${s.kind === "mcu" ? s.pin : s.kind === "const" ? (s.level ? "tied HIGH" : "tied LOW") : "unconnected"}`,
    );
    return `- ${m.side} motor: ${m.channel.mode} channel ${m.channel.out.join("/")} of ${m.driverInstanceId}, inputs ${ins.join(", ")}${m.polarity < 0 ? " (motor wires reversed)" : ""}`;
  });
  const sensors = w.sensors.map(
    (s) => `sensor ${String(s.index + 1)} → ${s.mcuPin ?? "not connected"}`,
  );
  return [
    `Microcontroller: ${w.mcu.name}.`,
    "Parts:",
    ...parts,
    "Motors (positive duty drives the robot forward on both sides):",
    ...motors,
    `Line sensors, from the robot's left to its right: ${sensors.join(", ")}.`,
    `Sensor output: ${wb.robot.sensors[0]?.output ?? "?"} (analog reads are higher over the dark line).`,
    ...(w.problems.length > 0 ? ["Wiring problems:", ...w.problems.map((p) => `- ${p}`)] : []),
  ].join("\n");
}

const cap = (s: string, n = 12_000) =>
  s.length > n ? `${s.slice(0, n)}\n[… ${String(s.length - n)} more characters]` : s;

async function evaluateText(wb: Workbench, source: string): Promise<string> {
  const ev = await wb.evaluate(source);
  if (!ev.ok)
    return `Compile errors:\n${ev.diagnostics.map((d) => `- line ${String(d.line)}: ${d.message}`).join("\n")}`;
  return reportText(ev);
}

function gateText(n: number, max: number, g: GateResult): string {
  if (g.accepted) {
    return `ACCEPTED (attempt ${String(n)} of ${String(max)}). Measured improvement: ${g.improvements.join("; ")}. Robustness ${pctS(g.before.robustness)} → ${pctS(g.after?.robustness ?? 0)}, completion ${g.before.meanCompletionPct.toFixed(0)} % → ${(g.after?.meanCompletionPct ?? 0).toFixed(0)} %. The user will see this patch. Now stop calling tools and write the final report.`;
  }
  return `REJECTED (attempt ${String(n)} of ${String(max)}):\n${g.reasons.map((r) => `- ${r}`).join("\n")}${n >= max ? "\nNo attempts left: stop calling tools and write the final report, saying plainly that no verified fix was found." : ""}`;
}
const pctS = (x: number) => `${String(Math.round(x * 100))} %`;

export type ToolOutcome = {
  content: string;
  isError: boolean;
  attempt?: Attempt;
  verified?: VerifiedPatch;
};

/** Run one tool call (input validated against its schema first). */
export async function runTool(
  name: string,
  rawInput: unknown,
  st: ToolState,
): Promise<ToolOutcome> {
  if (!(name in SCHEMAS)) return { content: `Unknown tool ${name}.`, isError: true };
  const parsed = SCHEMAS[name as ToolName].safeParse(rawInput);
  if (!parsed.success)
    return {
      content: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      isError: true,
    };
  const wb = st.workbench;
  const input = parsed.data as Record<string, unknown>;
  switch (name as ToolName) {
    case "get_firmware":
      return {
        content: st.baseline.source
          .replace(/\n$/, "")
          .split("\n")
          .map((l, i) => `${String(i + 1).padStart(4)}  ${l}`)
          .join("\n"),
        isError: false,
      };
    case "get_design_summary":
      return { content: designText(wb), isError: false };
    case "get_netlist":
      return {
        content: wb.opts.design.netlist
          .map(
            (n) =>
              `${n.name}: ${n.connections.map((c) => `${c.instanceId}.${c.pinId}`).join(", ")}`,
          )
          .join("\n"),
        isError: false,
      };
    case "get_run_report":
      return { content: reportText(st.baseline), isError: false };
    case "get_trace_window": {
      const w = Window.parse(input);
      return {
        content: wb.traceWindow(st.baseline, w.t_start_ms, w.t_end_ms, w.signals),
        isError: false,
      };
    }
    case "static_analysis": {
      const f = wb.lint(Code.parse(input).code);
      return {
        content:
          f.length > 0
            ? f
                .map((x) => `- line ${String(x.line)} ${x.ruleId} (${x.severity}): ${x.message}`)
                .join("\n")
            : "No findings.",
        isError: false,
      };
    }
    case "compile": {
      const r = await wb.compiler.compile({
        board: wb.opts.board,
        files: { [wb.opts.file]: Code.parse(input).code },
      });
      return r.ok
        ? {
            content: `Compiled: ${String(r.artifact.sizes.flashBytes)} bytes of flash${r.artifact.sizes.ramBytes ? `, ${String(r.artifact.sizes.ramBytes)} bytes of RAM` : ""}.`,
            isError: false,
          }
        : {
            content: `Compile errors:\n${r.diagnostics.map((d) => `- line ${String(d.line)}: ${d.message}`).join("\n")}`,
            isError: false,
          };
    }
    case "simulate":
      return { content: cap(await evaluateText(wb, Code.parse(input).code)), isError: false };
    case "search_fix_knowledge": {
      if (!st.knowledge) return { content: "No knowledge base is connected.", isError: false };
      const cases = await st.knowledge.search(Query.parse(input).query);
      return {
        content:
          cases.length > 0
            ? cases
                .map(
                  (c) =>
                    `Case ${c.id} (${c.source === "user" ? `confirmed on ${String(c.confirmations)} real robot(s)` : "synthetic: injected bug, fix verified in simulation only"}${c.parts.length ? `; parts: ${c.parts.join(", ")}` : ""})\nSymptoms: ${c.symptoms}\nDiagnosis: ${c.diagnosis}\nDiff:\n${c.diff}`,
                )
                .join("\n\n")
            : "No confirmed cases match.",
        isError: false,
      };
    }
    case "propose_patch": {
      const p = Patch.parse(input);
      if (st.verified)
        return { content: "A patch was already accepted. Write the final report.", isError: true };
      const n = st.attempts.length + 1;
      if (n > st.maxIterations)
        return { content: "No attempts left. Write the final report.", isError: true };
      const applied = applyUnifiedDiff(st.baseline.source, p.unified_diff);
      let gate: GateResult;
      if (!applied.ok) {
        gate = {
          accepted: false,
          reasons: [`The diff doesn't apply to the current sketch: ${applied.error}`],
          improvements: [],
          before: summarize(st.baseline),
          after: undefined,
        };
      } else gate = verifyPatch(st.baseline, await wb.evaluate(applied.text));
      const attempt: Attempt = {
        n,
        accepted: gate.accepted,
        reasons: gate.reasons,
        improvements: gate.improvements,
        rationale: p.rationale,
      };
      st.attempts.push(attempt);
      let verified: VerifiedPatch | undefined;
      if (gate.accepted && applied.ok && gate.after) {
        const after = await wb.evaluate(applied.text);
        if (after.ok) {
          verified = {
            diff: makeUnifiedDiff(st.baseline.source, applied.text, wb.opts.file),
            fullFile: applied.text,
            rationale: p.rationale,
            expectedEffect: p.expected_effect,
            improvements: gate.improvements,
            before: gate.before,
            after: gate.after,
            artifact: after.artifact,
          };
          st.verified = verified;
        }
      }
      return {
        content: gateText(n, st.maxIterations, gate),
        isError: false,
        attempt,
        ...(verified ? { verified } : {}),
      };
    }
  }
}
