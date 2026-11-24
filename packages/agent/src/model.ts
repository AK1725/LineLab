import type Anthropic from "@anthropic-ai/sdk";
import type { AgentConfig } from "./config.js";

export type Message = Anthropic.Beta.BetaMessage;
export type MessageParam = Anthropic.Beta.BetaMessageParam;
export type Tool = Anthropic.Beta.BetaTool;

export interface TurnRequest {
  system: string;
  tools: Tool[];
  messages: MessageParam[];
}

export interface TurnCallbacks {
  onText?: (delta: string) => void;
  onThinking?: (delta: string) => void;
}

/** One model turn. The live implementation streams from the API; tests replay scripted turns. */
export interface ModelClient {
  readonly name: string;
  turn(req: TurnRequest, cb: TurnCallbacks): Promise<Message>;
}

/**
 * Claude through the official SDK: streaming, adaptive thinking (summaries shown to the user),
 * effort from config, prompt caching on the stable system prompt + tools and on the growing
 * conversation, and the server-side refusal fallback.
 */
export class AnthropicModel implements ModelClient {
  readonly name: string;
  constructor(
    private readonly client: Anthropic,
    private readonly config: AgentConfig,
  ) {
    this.name = config.model;
  }

  async turn(req: TurnRequest, cb: TurnCallbacks): Promise<Message> {
    const stream = this.client.beta.messages.stream({
      model: this.config.model,
      max_tokens: this.config.maxTokensPerTurn,
      // Tools render before the system prompt, so this breakpoint caches both.
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      tools: req.tools,
      messages: req.messages,
      // Second breakpoint: the conversation so far (cached turn to turn).
      cache_control: { type: "ephemeral" },
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: this.config.effort },
      ...(this.config.fallbacks === "default"
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
    });
    if (cb.onText) stream.on("text", cb.onText);
    if (cb.onThinking) stream.on("thinking", cb.onThinking);
    return stream.finalMessage();
  }
}

/** One scripted assistant turn: content blocks and the stop reason. */
export interface ScriptedTurn {
  content: (
    | { type: "text"; text: string }
    | { type: "thinking"; thinking: string }
    | { type: "tool_use"; name: string; input: Record<string, unknown> }
  )[];
  stop_reason: Message["stop_reason"];
  /** Token usage to report for this turn (defaults to 0). */
  usage?: { input_tokens: number; output_tokens: number };
}

/**
 * Replays scripted turns in order (tests, the e2e path and demos without an API key). The
 * responses are written by hand or recorded from the live model; they are labelled as such
 * wherever they are used.
 */
export class ScriptedModel implements ModelClient {
  readonly name = "scripted";
  private i = 0;
  readonly requests: TurnRequest[] = [];
  constructor(private readonly turns: ScriptedTurn[]) {}

  turn(req: TurnRequest, cb: TurnCallbacks): Promise<Message> {
    this.requests.push(req);
    const t = this.turns[this.i++];
    if (!t) return Promise.reject(new Error("The script has no more turns."));
    const content = t.content.map((b, k) => {
      if (b.type === "text") {
        cb.onText?.(b.text);
        return { type: "text" as const, text: b.text, citations: null };
      }
      if (b.type === "thinking") {
        cb.onThinking?.(b.thinking);
        return { type: "thinking" as const, thinking: b.thinking, signature: "" };
      }
      return {
        type: "tool_use" as const,
        id: `toolu_script_${String(this.i)}_${String(k)}`,
        name: b.name,
        input: b.input,
      };
    });
    return Promise.resolve({
      id: `msg_script_${String(this.i)}`,
      type: "message",
      role: "assistant",
      model: "scripted",
      content,
      stop_reason: t.stop_reason,
      stop_sequence: null,
      usage: {
        input_tokens: t.usage?.input_tokens ?? 0,
        output_tokens: t.usage?.output_tokens ?? 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    } as unknown as Message);
  }
}
