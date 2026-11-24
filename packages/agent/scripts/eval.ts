// `pnpm eval:agent`: run the agent on every buggy fixture and report how many it fixes through
// the verification gate, in how many attempts, with how many tokens. Uses the real model, so it
// needs an API key (ANTHROPIC_API_KEY) and costs money; and a compiler: arduino-cli locally
// (ARDUINO_CLI, ARDUINO_DATA_DIR) or the compiler service (COMPILER_URL).
//   --only a,b      run some fixtures      --record dir   save each session's turns (replayable)
//   --out file      write the JSON summary
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { getChassis, getComponent } from "@linelab/component-db";
import { compile, configFromEnv } from "@linelab/compiler";
import { resolveChassis } from "@linelab/design-core";
import { Design, Track } from "@linelab/schema";
import { z } from "zod";
import { CachedCompiler, HttpCompiler, type Compiler } from "../src/compiler.js";
import { agentConfigFromEnv } from "../src/config.js";
import { AnthropicModel, type ModelClient, type ScriptedTurn } from "../src/model.js";
import { runAgentSession } from "../src/session.js";
import { Workbench } from "../src/workbench.js";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: { only: { type: "string" }, record: { type: "string" }, out: { type: "string" } },
});
const repo = join(import.meta.dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.error("eval:agent calls the real model: set ANTHROPIC_API_KEY. (Nothing was run.)");
  process.exit(2);
}
let inner: Compiler | undefined;
if (process.env.ARDUINO_CLI) {
  const cfg = configFromEnv();
  inner = { compile: (r) => compile(r, cfg) };
} else if (process.env.COMPILER_URL) inner = new HttpCompiler(process.env.COMPILER_URL);
else {
  console.error(
    "eval:agent compiles the agent's patches: set ARDUINO_CLI (+ ARDUINO_DATA_DIR) or COMPILER_URL. (Nothing was run.)",
  );
  process.exit(2);
}
const compiler = new CachedCompiler(join(repo, "examples", "firmware", ".compile-cache"), inner);
const config = agentConfigFromEnv();
const client = new Anthropic();
const expected = z
  .object({ fixtures: z.record(z.string(), z.object({ track: z.string() })) })
  .parse(JSON.parse(read("examples/firmware/buggy/expected.json")));
const design = Design.parse(JSON.parse(read("packages/sim-core/fixtures/reference.design.json")));
const chassis = resolveChassis(design, getChassis);
if (!chassis) throw new Error("chassis");

/** Wraps the live model and keeps each turn in the replayable ScriptedTurn shape. */
class Recorder implements ModelClient {
  readonly name: string;
  readonly turns: ScriptedTurn[] = [];
  constructor(private readonly inner: ModelClient) {
    this.name = inner.name;
  }
  async turn(...args: Parameters<ModelClient["turn"]>) {
    const m = await this.inner.turn(...args);
    this.turns.push({
      stop_reason: m.stop_reason,
      usage: { input_tokens: m.usage.input_tokens, output_tokens: m.usage.output_tokens },
      content: m.content.flatMap((b): ScriptedTurn["content"] =>
        b.type === "text"
          ? [{ type: "text", text: b.text }]
          : b.type === "thinking"
            ? [{ type: "thinking", thinking: b.thinking }]
            : b.type === "tool_use"
              ? [{ type: "tool_use", name: b.name, input: b.input as Record<string, unknown> }]
              : [],
      ),
    });
    return m;
  }
}

const names = Object.keys(expected.fixtures).filter(
  (n) => !values.only || values.only.split(",").includes(n),
);
const rows = [];
for (const name of names) {
  const fx = expected.fixtures[name];
  if (!fx) continue;
  const track = Track.parse(JSON.parse(read(`tracks/track.${fx.track}.json`)));
  const workbench = new Workbench(
    {
      design,
      chassis,
      lookup: getComponent,
      track,
      board: "arduino:avr:nano",
      file: "sketch.ino",
      seeds: [0],
    },
    compiler,
  );
  const model = new Recorder(new AnthropicModel(client, config));
  const t0 = Date.now();
  const r = await runAgentSession({
    model,
    workbench,
    config,
    source: read(`examples/firmware/buggy/${name}/${name}.ino`),
    request: "",
    boardName: "Arduino Nano",
    tier: "emulated",
  });
  const tokens =
    r.usage.inputTokens +
    r.usage.outputTokens +
    r.usage.cacheReadTokens +
    r.usage.cacheCreationTokens;
  rows.push({
    fixture: name,
    status: r.status,
    attempts: r.attempts.length,
    turns: r.usage.turns,
    tokens,
    cacheReadTokens: r.usage.cacheReadTokens,
    seconds: Math.round((Date.now() - t0) / 1000),
    improvements: r.verified?.improvements ?? [],
    note: r.note ?? null,
  });
  console.log(
    `${r.status === "fixed" ? "✓" : "✗"} ${name.padEnd(24)} ${r.status.padEnd(16)} attempts ${String(r.attempts.length)}  turns ${String(r.usage.turns)}  tokens ${String(tokens)}`,
  );
  if (values.record) {
    mkdirSync(values.record, { recursive: true });
    writeFileSync(
      join(values.record, `${name}.recorded.json`),
      `${JSON.stringify(model.turns, null, 2)}\n`,
    );
  }
}
const fixed = rows.filter((r) => r.status === "fixed" && r.attempts <= config.maxIterations).length;
const summary = {
  model: config.model,
  effort: config.effort,
  fixRate: rows.length > 0 ? fixed / rows.length : 0,
  fixed,
  total: rows.length,
  meanAttempts: rows.reduce((a, r) => a + r.attempts, 0) / Math.max(1, rows.length),
  totalTokens: rows.reduce((a, r) => a + r.tokens, 0),
  rows,
};
console.log(
  `\nFixed through the gate: ${String(fixed)}/${String(rows.length)} (${String(Math.round(summary.fixRate * 100))} %), mean attempts ${summary.meanAttempts.toFixed(1)}, ${String(summary.totalTokens)} tokens.`,
);
if (values.out) writeFileSync(values.out, `${JSON.stringify(summary, null, 2)}\n`);
process.exitCode = summary.fixRate >= 0.8 ? 0 : 1;
