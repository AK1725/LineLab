import { readFileSync } from "node:fs";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { agentConfigFromEnv, type AgentConfig } from "./config.js";
import { workbenchFor } from "./gate.test.js";
import { AnthropicModel, ScriptedModel, type ScriptedTurn } from "./model.js";
import { runAgentSession, sanitizeDiagnosis, type AgentEvent } from "./session.js";
import { TOOLS } from "./tools.js";

const repo = join(import.meta.dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const buggy = read("examples/firmware/buggy/blocking_delay/blocking_delay.ino");
const fix = read("examples/firmware/buggy/blocking_delay/fix.diff");
const config: AgentConfig = { ...agentConfigFromEnv({}), maxIterations: 5 };
const tool = (name: string, input: Record<string, unknown> = {}): ScriptedTurn => ({
  content: [{ type: "tool_use", name, input }],
  stop_reason: "tool_use",
});
const say = (text: string): ScriptedTurn => ({
  content: [{ type: "text", text }],
  stop_reason: "end_turn",
});

async function session(turns: ScriptedTurn[], over: Partial<AgentConfig> = {}) {
  const events: AgentEvent[] = [];
  const model = new ScriptedModel(turns);
  const result = await runAgentSession({
    model,
    workbench: workbenchFor("oval"),
    config: { ...config, ...over },
    source: buggy,
    request: "",
    boardName: "Arduino Nano",
    tier: "emulated",
    onEvent: (e) => events.push(e),
  });
  return { result, events, model };
}

describe("agent session", () => {
  it("a verified fix reaches the user with the diff, full file, before/after and compiled firmware", async () => {
    const { result, events, model } = await session([
      tool("get_run_report"),
      tool("propose_patch", {
        unified_diff: fix,
        rationale: "delay(25) blocks the loop.",
        expected_effect: "The loop runs at ~700 Hz again.",
      }),
      say(
        "At 0.00 s the loop blocks for 25 ms on line 69 (delay(25)), so the robot steers blind. Removing it restores a fast loop.",
      ),
    ]);
    expect(result.status).toBe("fixed");
    expect(result.verified?.fullFile).not.toContain("delay(25)");
    expect(result.verified?.diff).toContain('-  delay(25);  // "give the motors time to react"');
    expect(result.verified?.improvements.join(" ")).toMatch(/error events|static-analysis/);
    expect(result.verified?.artifact.hex).toMatch(/^:/);
    expect(events.filter((e) => e.type === "verified")).toHaveLength(1);
    // The report and the sketch went to the model as data, with line numbers.
    const first = model.requests[0]?.messages[0]?.content;
    expect(
      typeof first === "string" &&
        first.includes('<firmware file="sketch.ino">') &&
        first.includes("  69    delay(25);"),
    ).toBe(true);
  }, 120_000);

  it("never shows an unverified patch: a bad patch is rejected and code in the final text is removed", async () => {
    const bad = fix.replace(
      '-  delay(25);  // "give the motors time to react"',
      '-  delay(25);  // "give the motors time to react"\n+  delay(20);',
    );
    const { result, events } = await session([
      tool("propose_patch", {
        unified_diff: bad,
        rationale: "Shorter delay.",
        expected_effect: "Better.",
      }),
      say(
        "Here is my fix:\n```cpp\ndelay(20);\n```\n-  delay(25);\n+  delay(20);\nThe delay is the problem.",
      ),
    ]);
    expect(result.status).toBe("not_fixed");
    expect(result.verified).toBeUndefined();
    expect(events.some((e) => e.type === "verified")).toBe(false);
    expect(result.attempts[0]).toMatchObject({ accepted: false });
    expect(result.attempts[0]?.reasons.join(" ")).toMatch(/Nothing measurably improved/);
    expect(result.diagnosis).not.toMatch(/delay\(20\)/);
    expect(result.diagnosis).toContain("The delay is the problem.");
  }, 120_000);

  it("stops proposing after the iteration cap", async () => {
    const junk = {
      unified_diff: "@@ -1,1 +1,1 @@\n-nope\n+nope2\n",
      rationale: "x",
      expected_effect: "y",
    };
    const { result } = await session(
      [...Array.from({ length: 4 }, () => tool("propose_patch", junk)), say("I couldn't fix it.")],
      { maxIterations: 3 },
    );
    expect(result.attempts).toHaveLength(3);
    expect(
      result.attempts.every(
        (a) => !a.accepted && a.reasons[0]?.startsWith("The diff doesn't apply"),
      ),
    ).toBe(true);
    expect(result.status).toBe("not_fixed");
  }, 120_000);

  it("handles a refusal without running the turn's tools", async () => {
    const { result, events } = await session([
      {
        content: [
          {
            type: "tool_use",
            name: "propose_patch",
            input: { unified_diff: fix, rationale: "r", expected_effect: "e" },
          },
        ],
        stop_reason: "refusal",
      },
    ]);
    expect(result.status).toBe("refused");
    expect(result.attempts).toEqual([]);
    expect(events.some((e) => e.type === "tool_call")).toBe(false);
  }, 120_000);

  it("stops at the token budget", async () => {
    const { result } = await session(
      [
        { ...tool("get_firmware"), usage: { input_tokens: 9000, output_tokens: 2000 } },
        tool("get_netlist"),
        say("done"),
      ],
      { tokenBudget: 10_000 },
    );
    expect(result.status).toBe("budget_exhausted");
    expect(result.usage.turns).toBe(1);
  }, 120_000);

  it("rejects tool input that doesn't match the schema", async () => {
    const { events } = await session([
      tool("get_trace_window", { t_start_ms: 0, t_end_ms: 100, signals: ["bogus"] }),
      say("ok"),
    ]);
    expect(events.find((e) => e.type === "tool_result")).toMatchObject({ isError: true });
  }, 120_000);
});

describe("live model client request", () => {
  it("streams with adaptive thinking, effort, caching, strict tools and the refusal fallback", async () => {
    let params: Record<string, unknown> = {};
    const fakeStream = {
      on: () => fakeStream,
      finalMessage: () =>
        Promise.resolve({
          content: [],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
    };
    const client = {
      beta: { messages: { stream: (p: Record<string, unknown>) => ((params = p), fakeStream) } },
    } as unknown as Anthropic;
    await new AnthropicModel(client, agentConfigFromEnv({ LINELAB_AGENT_EFFORT: "xhigh" })).turn(
      { system: "S", tools: TOOLS, messages: [{ role: "user", content: "hi" }] },
      {},
    );
    expect(params).toMatchObject({
      model: "claude-opus-5-5",
      system: [{ type: "text", text: "S", cache_control: { type: "ephemeral" } }],
      cache_control: { type: "ephemeral" },
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "xhigh" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    expect(TOOLS.every((t) => t.strict === true && t.eager_input_streaming === true)).toBe(true);
    expect(agentConfigFromEnv({ LINELAB_AGENT_MODEL: "claude-sonnet-5-5" }).model).toBe(
      "claude-sonnet-5-5",
    );
  });
  it("keeps prose bullets but strips code from reports", () => {
    expect(sanitizeDiagnosis("- The base speed is too high.\n+  delay(5);\n```\nx\n```\nok")).toBe(
      "- The base speed is too high.\n[code removed: LineLab shows only verified patches]\nok",
    );
  });
});
