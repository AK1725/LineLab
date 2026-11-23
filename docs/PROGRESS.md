# Progress

## Phase 0 — Foundation ✅ (branch `phase-0-foundation`)

**Done**

- pnpm + Turborepo monorepo with every workspace from BLUEPRINT §3.1. All build, lint and typecheck, including the placeholders.
- `packages/schema`: Zod schemas for Component, Pin, ElectricalSpec, Chassis, Design, Placement, Net, FirmwareRef, TwinParams, Track, RunTrace, Frame, SimEvent, RunMetrics, Finding. Cross-field rules: unique pin ids, category ↔ spec kind, battery voltage order, left/right wheels, unique decks, unique instances, nets that reference real parts, one net per pin, distinguishable track reflectance, time-ordered frames. Generated JSON Schema (draft 2020-12) is committed in `packages/schema/json-schema/`, with a drift test.
- `packages/component-db`: `pnpm db:validate` validates components, chassis and `tracks/` (schema, file name = id, ids unique).
- `apps/api`: Fastify `GET /health`, env config validated with Zod, Dockerfile.
- `apps/vision`: FastAPI `GET /health`, ruff + mypy strict + pytest (warnings are errors), uv lockfile, Dockerfile. Runs inside `pnpm verify`.
- `apps/web`: Next.js 16 landing page with the roadmap, Tailwind v4, light and dark tokens, Dockerfile (standalone output).
- `e2e`: Playwright smoke tests (title, headings, no console errors, no horizontal scroll at 375 px).
- `docker-compose.yml`: Postgres 16 + pgvector, Redis 7, SeaweedFS S3 + bucket init. App services behind the `apps` profile.
- CI (`.github/workflows/ci.yml`): verify, e2e, and docker jobs. Dependabot for actions, npm, uv and docker.
- Docs: README, CONTRIBUTING, LICENSE (Apache-2.0), ADRs 0001–0003.

**Verified locally**

- `pnpm verify` green: format check, lint, typecheck, 45 unit tests (schema 36, component-db 3, api 4, vision 2), db:validate, build.
- `pnpm test:e2e`: 2/2 passed.
- `docker compose up -d`: all infrastructure healthy. pgvector 0.8.7 extension created, Redis PONG, signed S3 PUT/GET/DELETE OK, anonymous S3 access returns 403.
- `api`, `vision` and `web` images build and serve their endpoints as non-root users. (Verified with the sandbox's proxy CA injected into a temporary copy of each Dockerfile. The committed Dockerfiles need no proxy.)

**Deferred / known issues**

- CI has not run on GitHub yet: the repo has no remote. Action versions (`checkout@v4`, `setup-node@v4`, `pnpm/action-setup@v4`, `setup-uv@v6`) were not checked against the latest releases. Dependabot will bump them.
- `Finding.fix.operations` is `unknown[]` until Phase 3 defines the typed `DesignOperation` union. The UI offers no fixes until then.
- `apps/compiler` is not in docker-compose until Phase 6, so nothing fake runs.
- `lfr-hal` and `telemetry-lib` are README-only placeholders (C/C++ arrives in Phases 6 and 9).

## Next: Phase 1 — Component database, search, procedural 3D models
