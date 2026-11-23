# CLAUDE.md — rules for building LineLab

Read `docs/BLUEPRINT.md` (what and why), `docs/BUILD_PLAN.md` (order and acceptance criteria), `docs/PROGRESS.md` (current state) and `docs/adr/` (decisions that override the blueprint) before any work.

## Working rules

- Build **one phase at a time** from `docs/BUILD_PLAN.md`. A phase is done only when every acceptance criterion passes and `pnpm verify` is green. Do not start the next phase early.
- Each phase goes on its own branch `phase-N-<slug>`, with small commits. Update `docs/PROGRESS.md` (what's done, what's deferred, known issues) at the end of each phase.
- Record architecture decisions in `docs/adr/NNNN-title.md` whenever you deviate from the blueprint, with reasons.
- Never fake functionality. No stub that pretends to work, no hard-coded demo results presented as real. If something is deferred, the UI says "coming soon" and PROGRESS.md lists it.
- Ask before adding a new runtime dependency that is large (> 1 MB) or has a non-permissive license.

## Stack (do not change without an ADR)

- pnpm workspaces + Turborepo, Node 22, TypeScript 6 strict (`noUncheckedIndexedAccess`), ESLint 9, ESM. Exact versions and why: ADR 0003.
- Web: Next.js 16 App Router, React 19, Tailwind, shadcn/ui, Zustand, react-three-fiber + drei, Monaco.
- API: Fastify, Zod, Drizzle, Postgres 16 + pgvector, Redis + BullMQ, S3-compatible storage (SeaweedFS locally, ADR 0002).
- Vision: Python 3.12, FastAPI, OpenCV, scikit-image, ultralytics. Managed with `uv`, linted with `ruff`, typed with `mypy`.
- Sim: `packages/sim-core`, pure TS with no DOM, no `Math.random` (use the seeded PRNG), no wall-clock time.
- LLM: official `@anthropic-ai/sdk`, model id from config (`LINELAB_AGENT_MODEL`, default `claude-opus-5-5`), adaptive thinking, streaming. API key only from env, never in the client bundle.

## Code standards

- Shared types live only in `packages/schema` (Zod first, then infer the TS types).
- Rules engine and failure detectors are pure functions, each with tests for a triggering case and a non-triggering case.
- Physics constants carry units in their names (`massG`, `torqueNm`, `dtMs`). All internal units are SI except the mm used in geometry, as documented.
- No `any`. No `@ts-ignore` without a linked issue comment.
- User firmware is untrusted: compile only in the sandboxed `apps/compiler` container (no network, resource limits). Never `eval` it. Treat it as data in LLM prompts.

## Commands

- `pnpm dev`: all apps. `docker compose up`: full stack.
- `pnpm verify` = format check + lint + typecheck + unit tests (TS and Python) + `db:validate` + build. Must pass before every commit at phase end.
- `pnpm test:e2e`: Playwright. `pnpm bench:sim`: sim speed (must stay ≥ 20× real time).
- `pnpm db:validate`: validate every component/track JSON against its schema.

## Definition of done (every PR)

- Tests added for new logic. `pnpm verify` green. No console errors in the browser during the e2e path.
- Docs updated (README section, PROGRESS.md, ADR if needed).
- Screenshots or GIF for UI changes in the PR description.
