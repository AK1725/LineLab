/** Agent settings. The model ID and effort come from configuration, never from scattered literals. */
export interface AgentConfig {
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  /** Patch attempts (propose_patch calls) per session before the agent must report. */
  maxIterations: number;
  /** Total tokens (input incl. cache, plus output) a session may use before it stops. */
  tokenBudget: number;
  /** Output cap per model turn (streamed). */
  maxTokensPerTurn: number;
  /** Model turns per session (a hard stop independent of tokens). */
  maxTurns: number;
  /** Server-side refusal fallback ("default" = let the API pick), or off. */
  fallbacks: "default" | "off";
}

export const DEFAULT_MODEL = "claude-opus-5-5";

export function agentConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): AgentConfig {
  const effort = env.LINELAB_AGENT_EFFORT;
  return {
    model: env.LINELAB_AGENT_MODEL ?? DEFAULT_MODEL,
    effort:
      effort === "low" || effort === "medium" || effort === "xhigh" || effort === "max"
        ? effort
        : "high",
    maxIterations: Number(env.LINELAB_AGENT_MAX_ITERATIONS ?? 5),
    tokenBudget: Number(env.LINELAB_AGENT_TOKEN_BUDGET ?? 1_500_000),
    maxTokensPerTurn: Number(env.LINELAB_AGENT_MAX_TOKENS ?? 32_000),
    maxTurns: Number(env.LINELAB_AGENT_MAX_TURNS ?? 40),
    fallbacks: env.LINELAB_AGENT_FALLBACKS === "off" ? "off" : "default",
  };
}
