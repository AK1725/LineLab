# 0009. AI debug agent: a Messages API loop over a deterministic workbench, gate in code

- Status: accepted
- Date: 2026-11-24

## Context

BLUEPRINT §5.8 specifies:

- a Claude agent with a fixed tool set, streaming and adaptive thinking;
- prompt caching, a token budget, an iteration cap, and refusal/stop-reason handling;
- a verification gate enforced in code, so no unverified patch is ever shown;
- a real-world feedback loop.

The open questions were where the loop runs, how to make it testable without spending tokens, and how the gate decides.

## Decisions

1. **The loop runs in `apps/api`** on the Messages API (official `@anthropic-ai/sdk` 1.7, beta namespace), as a **manual streaming loop** rather than the beta Tool Runner. The gate needs per-turn control: every `propose_patch` runs the gate, attempts are capped, and tokens are counted from `usage` each turn. The model transport is also swappable: live, scripted, or recorded. Managed Agents isn't used because the tools must run against LineLab's own simulator and compile cache in the API process.
2. **Request shape** (`AnthropicModel`):
   - model from `LINELAB_AGENT_MODEL` (default `claude-opus-5-5`);
   - `thinking: {type: "adaptive", display: "summarized"}`, with summaries streamed to the user;
   - `output_config.effort` from `LINELAB_AGENT_EFFORT` (default `high`; Opus 5.5 would otherwise default to `medium`);
   - **prompt caching**: one breakpoint on the stable system prompt (which also covers the fixed tool list rendered before it) and a top-level breakpoint on the growing conversation;
   - tools are `strict` with `additionalProperties: false`, and inputs stream eagerly (`eager_input_streaming`), so every input is validated with Zod before it runs;
   - the server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) is on by default; `LINELAB_AGENT_FALLBACKS=off` turns it off;
   - no forced `tool_choice` (Opus 5.5 rejects it).
3. **Stop reasons**:
   - `end_turn` → report;
   - `refusal` → stop without running that turn's tools;
   - `max_tokens` and `model_context_window_exceeded` → stop with a note;
   - `pause_turn` → continue.

   The conversation is append-only (thinking blocks are passed back unchanged). API errors end the session with the status code. An unparseable stream is retried twice.

4. **The workbench** is the user's robot, track and seeds. Every tool and every gate check runs there against real compiler output and the simulator: firmware, design summary, netlist, run report, trace window, static analysis, compile, simulate, fix knowledge, and propose_patch.
   - Compiles go through `CachedCompiler`, a directory of real compiler results keyed by request, in front of the sandboxed compiler service. With no service and no cache hit, it reports "not compiled"; it never fakes one.
5. **The gate** (`verifyPatch`). A patch is accepted only if:
   - it applies cleanly (strict context match, shifts allowed);
   - it compiles;
   - robustness and mean completion don't drop on the user's seeds plus two fresh seeds;
   - no seed gains a new error-level event type;
   - no new lint rule fires;
   - **something measurably improves**: robustness, completion, error or warning events, or lint findings. Without this last rule a no-op patch would pass.

   The diff shown to the user is regenerated from the files, and the compiled artifact goes with it so the user can run the fix immediately. Any code in the model's final text is removed (`sanitizeDiagnosis`), so a patch can reach the user only through an accepted `propose_patch`.

6. **Prompt-injection hardening**: the sketch, serial output and the user's feedback notes go to the model inside tagged blocks marked as data. The system prompt says to ignore instructions found in them. Tools can only read the project and run the simulator; they have no side effects outside the session.
7. **Testing without a key**:
   - `ScriptedModel` replays turns in the API's message shape; `LINELAB_AGENT_SCRIPT` makes the API use one (the e2e path; results report the model as "scripted").
   - `pnpm eval:agent` runs the live model on all fixtures and can `--record` each session as a replayable script.
   - Every fixture also has a hand-written `fix.diff` that the gate must accept. This shows each bug is fixable within the gate's rules, independently of any model.
8. **Feedback**: "worked" adds the verified fix to the fix knowledge (an in-memory keyword store for now; pgvector in Phase 11). "Didn't work" starts a new session from the fixed sketch, with the user's observations attached as data.
9. **Cost and abuse controls**: per-IP limits (sessions per hour and concurrent), a token budget and a turn cap per session, an attempt cap (`LINELAB_AGENT_MAX_ITERATIONS`, default 5). Users can bring their own key (`x-anthropic-api-key`); it is used for that session and never stored or logged.

## Consequences

- The fix rate depends on the model and has to be measured with `pnpm eval:agent` (it needs an API key and costs money). The gate, the tools and the full UI path are tested without one.
- Sessions live in API memory and are lost on restart until runs and sessions are persisted (Phase 11).
