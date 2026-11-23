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

## Phase 1 — Component database, search, procedural 3D models ✅ (branch `phase-1-components`)

**Done**

- **124 components** in `packages/component-db/data/components/` across all 17 categories: 18 MCUs (full pinouts, including ESP32 ADC1/ADC2 and input-only pins, STM32 per-pin 5 V tolerance), 12 line sensors, 11 motor drivers, 17 motors, 12 batteries, 9 regulators, 7 wheels, plus casters, sensors, radios, displays, inputs, indicators, fans, ESC, mechanical and misc parts.
- Schema additions: `specStatus` (`needs-review` / `reviewed`), `notes`, pin `adcUnit` / `adcChannel` / `inputOnly`, MCU `fqbn`. `Board` moved to its own module and gained Micro, Nano 33 IoT, Pico W and XIAO RP2040.
- `packages/three-models`: 19 procedural generators (Z up, mm), including `pcb_board` with headers, ICs, USB, heatsink, inductor, screen and transducers, plus `ir_sensor_array`, `gearmotor_n20`, `tt_motor`, `dc_motor_can`, `wheel`, `ball_caster`, `battery_pack`, `battery_holder`, `edf_fan`, `to220` and more. Every generator is tested to fit inside, and fill most of, its declared box.
- `db:validate` now also checks, per component: the model builds and fits `dimensionsMm`, `arduinoPin` names are unique, MCU pin voltages match the logic level, line-sensor output count equals channels, drivers have 2 outputs per channel, wheel dimensions match, and no search alias is shared by two parts.
- Search (`createSearchIndex`): exact and prefix model-number matching, every-word matching for multi-word queries, number-safe suffix matching, fuzzy fallback for typos (Fuse.js), category filter.
- Web: `/components` (search, category chips, URL state) and 124 statically generated `/components/[id]` pages, each with an interactive 3D viewer (react-three-fiber), a spec table, a pin table, sources and a "needs review" badge. Home page links to the catalog.

**Verified locally**

- `pnpm verify` green: 111 unit tests (schema 38, three-models 35, component-db 32, api 4, vision 2), `db:validate` 124/124 with 0 problems.
- `pnpm test:e2e`: 137/137. All 5 acceptance queries return the right part first, **all 124 component pages render a WebGL model with no console errors**, URL state survives reload, typo fallback works, unknown ids return 404, no horizontal scroll at 375 px.
- Visual spot-check of 16 models (contact sheet). Fixed the EDF duct rendering one-sided.

**Deferred / known issues**

- **No spec has been checked against its datasheet.** Manufacturer and datasheet sites (pololu.com, vishay.com and others) are blocked in the cloud dev container, so every entry is `needs-review` and the UI says so. Values come from manufacturer documentation and common module listings, written without the documents open. Generic modules point to chip datasheets or distributor searches.
- Source URLs are not link-checked yet (same network restriction). A `db:check-links` script is a good follow-up for a machine with open internet.
- Teensy 4.0 bottom pads (24–39) are not listed. Pololu QTR-MD/HD dimensions are approximate.
- Models are intentionally simple (boxes and cylinders). glTF models are rejected by validation until a later phase.

## Next: Phase 2 — 3D assembly editor and chassis
