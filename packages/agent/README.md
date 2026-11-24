# @linelab/agent

LineLab's AI debug agent ([ADR 0009](../../docs/adr/0009-ai-debug-agent.md)). Claude reads the run report and the sketch, tests ideas in the simulator, and submits fixes through a **verification gate enforced in code**. A patch reaches the user only if it applies, compiles, and measurably fixes something on the user's seeds plus fresh seeds without any regression.

- `runAgentSession(...)`: the streaming tool loop. It handles stop reasons (including refusals), the iteration cap, the token budget and turn cap, and append-only history. It emits `AgentEvent`s (text, thinking summary, tool activity, attempts, verified patch, done).
- `AnthropicModel`: the live client: adaptive thinking, effort from config, prompt caching, strict tools with eager input streaming, server-side refusal fallback. `ScriptedModel` replays turns (tests, demos, e2e).
- `Workbench`: compile (through `CachedCompiler` / `HttpCompiler`), simulate every seed, build reports, trace windows.
- `verifyPatch`: the gate. `applyUnifiedDiff` / `makeUnifiedDiff`: strict patching and display diffs.

Configuration: `LINELAB_AGENT_MODEL` (default `claude-opus-5-5`), `LINELAB_AGENT_EFFORT` (`high`), `LINELAB_AGENT_MAX_ITERATIONS` (5), `LINELAB_AGENT_TOKEN_BUDGET` (1.5 M), `LINELAB_AGENT_MAX_TURNS` (40), `LINELAB_AGENT_FALLBACKS` (`default`/`off`).

Run the eval:

```bash
ANTHROPIC_API_KEY=… ARDUINO_CLI=… ARDUINO_DATA_DIR=… pnpm eval:agent -- --record /tmp/sessions --out /tmp/eval.json
```

It uses the real model and costs money. It reports the fix rate through the gate, attempts and tokens per fixture.

Refresh the reference fixes and the compile cache (needs arduino-cli):

```bash
pnpm --filter @linelab/agent exec tsx scripts/reference-fixes.ts
```
