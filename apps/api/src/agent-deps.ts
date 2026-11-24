import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import {
  agentConfigFromEnv,
  AnthropicModel,
  CachedCompiler,
  HttpCompiler,
  MemoryKnowledge,
  ScriptedModel,
  type ScriptedTurn,
} from "@linelab/agent";
import type { AgentDeps } from "./agent-routes.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * Agent dependencies from the environment.
 * - ANTHROPIC_API_KEY (or another SDK credential): the server's key. Users can also send their
 *   own key per session (x-anthropic-api-key); it is used for that session only, never stored
 *   or logged.
 * - LINELAB_AGENT_SCRIPT: replay a scripted transcript instead of calling the API (demos, e2e).
 *   Results then report the model as "scripted".
 * - COMPILER_URL: the compiler service; LINELAB_COMPILE_CACHE: where compile results are cached.
 */
export function agentDepsFromEnv(env: NodeJS.ProcessEnv = process.env): AgentDeps {
  const config = agentConfigFromEnv(env);
  const script = env.LINELAB_AGENT_SCRIPT;
  const turns = script ? (JSON.parse(readFileSync(script, "utf8")) as ScriptedTurn[]) : undefined;
  const serverKey = Boolean(env.ANTHROPIC_API_KEY ?? env.ANTHROPIC_AUTH_TOKEN);
  return {
    config,
    compiler: new CachedCompiler(
      env.LINELAB_COMPILE_CACHE ?? join(repoRoot, "examples", "firmware", ".compile-cache"),
      env.COMPILER_URL ? new HttpCompiler(env.COMPILER_URL) : undefined,
    ),
    knowledge: new MemoryKnowledge(),
    modelFor: (byoKey) => {
      if (turns) return new ScriptedModel(turns);
      if (byoKey) return new AnthropicModel(new Anthropic({ apiKey: byoKey }), config);
      return serverKey ? new AnthropicModel(new Anthropic(), config) : undefined;
    },
    limits: {
      perHour: Number(env.LINELAB_AGENT_PER_HOUR ?? 10),
      concurrent: Number(env.LINELAB_AGENT_CONCURRENT ?? 2),
    },
  };
}
