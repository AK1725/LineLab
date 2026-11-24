import Anthropic from "@anthropic-ai/sdk";
import type { AgentConfig } from "./config.js";
import type { FixKnowledge } from "./knowledge.js";
import type { Message, MessageParam, ModelClient } from "./model.js";
import { firstMessage, SYSTEM_PROMPT } from "./prompt.js";
import {
  reportText,
  runTool,
  TOOLS,
  type Attempt,
  type ToolState,
  type VerifiedPatch,
} from "./tools.js";
import type { Workbench } from "./workbench.js";

export type AgentStatus = "fixed" | "not_fixed" | "refused" | "budget_exhausted" | "error";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  turns: number;
}

export interface AgentResult {
  status: AgentStatus;
  /** The model's explanation, with any code removed (only verified patches show code). */
  diagnosis: string;
  verified: VerifiedPatch | undefined;
  attempts: Attempt[];
  usage: Usage;
  model: string;
  /** Why the session stopped, when it wasn't a normal finish. */
  note: string | undefined;
}

export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "thinking"; delta: string }
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string }
  | { type: "tool_result"; id: string; name: string; summary: string; isError: boolean }
  | { type: "attempt"; attempt: Attempt }
  | { type: "verified"; patch: VerifiedPatch }
  | { type: "done"; result: AgentResult };

export interface SessionInput {
  model: ModelClient;
  workbench: Workbench;
  config: AgentConfig;
  source: string;
  request: string;
  boardName: string;
  tier: "emulated" | "hal";
  /** Real-world test feedback on a previous fix, when the loop restarts. */
  feedback?: string;
  knowledge?: FixKnowledge;
  onEvent?: (e: AgentEvent) => void;
  signal?: AbortSignal;
}

/**
 * Remove code from the model's report: only the gate-verified diff and file are ever shown, so a
 * fenced block or a diff in prose can't slip an unverified change to the user.
 */
export function sanitizeDiagnosis(text: string): string {
  return (
    text
      .replace(/```[\s\S]*?(```|$)/g, "[code removed: LineLab shows only verified patches]")
      .split("\n")
      // Diff headers, and +/- lines that end like code (";", "{" or "}"); prose bullets stay.
      .filter((l) => !/^(@@ |--- |\+\+\+ )/.test(l) && !/^[+-].*[;{}]\s*$/.test(l))
      .join("\n")
      .trim()
  );
}

const textOf = (m: Message) =>
  m.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n")
    .trim();

/** Run one debugging session: diagnose, test fixes through the gate, report. */
export async function runAgentSession(input: SessionInput): Promise<AgentResult> {
  const emit = (e: AgentEvent) => input.onEvent?.(e);
  const usage: Usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    turns: 0,
  };
  const finish = (
    status: AgentStatus,
    diagnosis: string,
    st: ToolState | undefined,
    note?: string,
  ): AgentResult => {
    const result: AgentResult = {
      status,
      diagnosis: sanitizeDiagnosis(diagnosis),
      verified: st?.verified,
      attempts: st?.attempts ?? [],
      usage,
      model: input.model.name,
      note,
    };
    emit({ type: "done", result });
    return result;
  };

  emit({ type: "status", message: "Running your sketch on the user's seeds and fresh seeds…" });
  const baseline = await input.workbench.evaluate(input.source);
  if (!baseline.ok)
    return finish(
      "error",
      "",
      undefined,
      `Your sketch doesn't compile (${baseline.diagnostics[0]?.message ?? "see the Code tab"}). Fix the compile errors first.`,
    );
  const st: ToolState = {
    workbench: input.workbench,
    baseline,
    knowledge: input.knowledge,
    attempts: [],
    verified: undefined,
    maxIterations: input.config.maxIterations,
  };
  const messages: MessageParam[] = [
    {
      role: "user",
      content: firstMessage({
        request: input.request,
        boardName: input.boardName,
        tier: input.tier,
        trackName: input.workbench.opts.track.name,
        file: input.workbench.opts.file,
        source: input.source,
        reportText: reportText(baseline),
        ...(input.feedback ? { feedback: input.feedback } : {}),
      }),
    },
  ];

  let lastText = "";
  let jsonRetries = 0;
  for (;;) {
    if (input.signal?.aborted)
      return finish(st.verified ? "fixed" : "error", lastText, st, "Stopped by the user.");
    const spent =
      usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
    if (spent >= input.config.tokenBudget)
      return finish(
        st.verified ? "fixed" : "budget_exhausted",
        lastText,
        st,
        `The session used its token budget (${String(input.config.tokenBudget)} tokens).`,
      );
    if (usage.turns >= input.config.maxTurns)
      return finish(
        st.verified ? "fixed" : "not_fixed",
        lastText,
        st,
        `The session reached its limit of ${String(input.config.maxTurns)} model turns.`,
      );

    let msg: Message;
    try {
      msg = await input.model.turn(
        { system: SYSTEM_PROMPT, tools: TOOLS, messages },
        {
          onText: (d) => {
            emit({ type: "text", delta: d });
          },
          onThinking: (d) => {
            emit({ type: "thinking", delta: d });
          },
        },
      );
      jsonRetries = 0;
    } catch (err) {
      // API errors (auth, rate limit, overload after the SDK's retries) end the session; a tool
      // input that couldn't be parsed or a dropped stream is retried a couple of times.
      if (err instanceof Anthropic.APIError)
        return finish(
          st.verified ? "fixed" : "error",
          lastText,
          st,
          `The model API returned an error (${String(err.status ?? "?")}): ${err.message}`,
        );
      if (jsonRetries++ >= 2)
        return finish(
          st.verified ? "fixed" : "error",
          lastText,
          st,
          `The model's response couldn't be read: ${(err as Error).message}`,
        );
      continue;
    }
    usage.turns++;
    usage.inputTokens += msg.usage.input_tokens;
    usage.outputTokens += msg.usage.output_tokens;
    usage.cacheReadTokens += msg.usage.cache_read_input_tokens ?? 0;
    usage.cacheCreationTokens += msg.usage.cache_creation_input_tokens ?? 0;
    // Keep every block (thinking included) unchanged: the conversation is append-only.
    messages.push({ role: "assistant", content: msg.content });
    const text = textOf(msg);
    if (text) lastText = text;

    switch (msg.stop_reason) {
      case "end_turn":
      case "stop_sequence":
        return finish(st.verified ? "fixed" : "not_fixed", lastText, st);
      case "refusal":
        // A refused turn may hold a cut-off tool call: never run it.
        return finish(
          st.verified ? "fixed" : "refused",
          lastText,
          st,
          "The model declined to continue this request.",
        );
      case "max_tokens":
        return finish(
          st.verified ? "fixed" : "error",
          lastText,
          st,
          "The model's reply was cut off at the output limit.",
        );
      case "model_context_window_exceeded":
        return finish(
          st.verified ? "fixed" : "error",
          lastText,
          st,
          "The conversation outgrew the model's context window.",
        );
      case "pause_turn":
      case "compaction":
        continue;
      case "tool_use":
      case null:
        break;
    }
    const calls = msg.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );
    if (calls.length === 0) return finish(st.verified ? "fixed" : "not_fixed", lastText, st);

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      emit({ type: "tool_call", id: call.id, name: call.name });
      let out;
      try {
        out = await runTool(call.name, call.input, st);
      } catch (err) {
        out = { content: `The tool failed: ${(err as Error).message}`, isError: true };
      }
      emit({
        type: "tool_result",
        id: call.id,
        name: call.name,
        summary: out.content.split("\n")[0]?.slice(0, 200) ?? "",
        isError: out.isError,
      });
      if ("attempt" in out && out.attempt) emit({ type: "attempt", attempt: out.attempt });
      if ("verified" in out && out.verified) emit({ type: "verified", patch: out.verified });
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: out.content,
        ...(out.isError ? { is_error: true } : {}),
      });
    }
    // All results of one turn go back in a single user message.
    messages.push({ role: "user", content: results });
  }
}
