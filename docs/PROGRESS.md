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

## Phase 2 — 3D assembly editor and chassis ✅ (branch `phase-2-assembly`)

**Done**

- **New package `packages/design-core`** (ADR 0004): mass and CoG, oriented-box collisions, snapping, measurements, undo/redo with drag coalescing, smart default placement, outline presets, hole grids, and DXF/SVG/STL import and export.
- **6 chassis templates** (`data/chassis/`): starter 2WD (acrylic, TT), PCB racer (FR4 T-shape), long-nose T-frame (carbon), downforce racer (fan cutout), 4WD robust (two decks) and compact maze solver (octagon). Deck heights are derived from wheel and motor sizes. Each is labelled with the archetype it is inspired by.
- Schema: Placement `mount` (top/bottom) and `standoffMm` (spacers), Chassis `mountHoleDiameterMm`.
- `three-models`: `buildChassisModel` (every deck, cutouts and holes) and `mergeByMaterial` (one mesh per material).
- **Web editor** at `/build` → `/build/edit?id=…`:
  - parts search with smart "Add"
  - 3D, top and side cameras
  - drag to move with snapping (grid, wheel/caster mounts, mounting holes, deck edges)
  - shift-click multi-select
  - rotate, nudge, duplicate and delete, with keyboard shortcuts
  - undo/redo
  - collision outlines
  - overlays for CoG, track width, look-ahead and sensor height
  - inspector with position, rotation, deck, mount side and spacer
  - mass/CoG panel and collision list
- **Custom chassis designer**: presets, a draggable SVG outline editor (insert/delete points), material, thickness, deck height, wheel and caster mounts, hole grid, live plate mass and CoG, and SVG/DXF/STL import.
- **Persistence**: autosave to IndexedDB, a saved-designs list, JSON export/import, and DXF (laser) and STL (3D print) chassis export.

**Verified locally**

- `pnpm verify` green: 163 unit tests (design-core 47, schema 38, three-models 38, component-db 34, api 4, vision 2).
- Hand-calculated CoG fixture: 50 g at (10, 2, 23.2) mm, matched to 1e-9.
- Undo/redo: three seeded runs of 150 random commands each, checked at every step back and forward.
- A clean (collision-free) robot auto-assembles on all six templates.
- `pnpm test:e2e`: 144/144, including:
  - **a full 2WD robot built from a template in about 8 s** (limit: 3 min), checked collision-free, with a schema-valid JSON export, and it survives a reload
  - mouse drag snaps to the grid and is a single undo step
  - keyboard shortcuts
  - custom chassis with DXF/STL download
  - template switching re-seats parts
  - JSON import
  - render budget with 60 parts

**Deferred / known issues**

- **60 fps is not measured on a real GPU.** This container and CI use SwiftShader (CPU), where fps follows pixel count. The test enforces the GPU budget instead: 60 parts = 193 draw calls, about 18k triangles, about 1 ms CPU per frame. To do: run `pnpm test:e2e -g "rendering budget"` on a machine with a GPU and record real fps.
- STL import uses the convex hull (notches are lost). SVG `transform` attributes are ignored. Both are stated in the UI and in code.
- No gizmo handles: rotation is by keyboard, buttons or a number field. The outline editor has no bezier or fillet editing beyond presets.
- Designs are stored per browser until accounts arrive (Phase 11).

## Data review — top parts (branch `data-review-top-parts`)

- 24 components verified against manufacturer pages/datasheets and marked `reviewed`. 36 entries corrected in total. See [`data-review-2026-11-23.md`](data-review-2026-11-23.md) for every change and its source.
- Component pages show a "checked against the datasheet" badge for reviewed parts.
- ST parts remain unverified (st.com refuses automated access).

## Phase 3 — Wiring and rules engine ✅ (branch `phase-3-wiring`)

**Done**

- Schema: `DesignCommand` (Zod) is now the single definition of every design change: add/remove/update/set-chassis/rename plus **connect, disconnect, rename-net, set-netlist**. `Finding.fix.operations` is typed with it. Components gained `i2cAddresses`.
- `design-core`: netlist commands with undo (nets merge on connect, nets with < 2 pins are pruned), **auto-wiring** (`autoWire`), and a **KiCad netlist** exporter.
- `packages/rules-engine`: a circuit model (net voltages from sources, signal levels per pin) plus **35 electrical** and **15 mechanical** rules, each with a plain-language explanation. One-click fixes for: joining grounds, tying TB6612 STBY high, setting sensor and caster spacers. Runs in about 10 ms per design.
- Editor: Parts/Wiring tabs, click-two-pins wiring, net list with rename/disconnect, Auto-wire/Clear, colour-coded 3D wires, a Checks panel (severity, explanation, Show, Fix, and each fix is one undo step), a **net-label schematic** view with SVG/PNG/print-to-PDF export, and **KiCad** netlist download.
- Data fixes found by the new checks: line-sensor outputs no longer claim a fixed 5 V level (they follow their supply; this caused false 5 V-into-3.3 V errors on ESP32), and the Pololu DRV8833 SLP pin is correctly described as pulled high on the board.
- CI now runs on every pushed branch.

**Verified locally**

- rules-engine: 115 tests. Every rule has a test that triggers it and a test that the clean reference robot doesn't, plus fix-clears-finding tests and a < 50 ms performance test. A mutation check (two rules deliberately broken) made exactly those tests fail.
- The five acceptance fixtures (`good_nano_tb6612_qtr8`, `bad_no_common_ground`, `bad_esp32_adc2_wifi`, `bad_9v_battery`, `bad_5v_into_pico`) produce exactly their expected findings.
- e2e: auto-wire → one-click fixes → "No problems found", manual pin-to-pin wiring, schematic + KiCad export, STBY fix and undo.

**Deferred / known issues**

- Pin positions in 3D are approximate: two rows on the part's top face. Real header coordinates aren't in the component data yet.
- No resistor/capacitor parts yet, so `elec.led-resistor` can only advise.
- The schematic uses net labels, not routed wires.
- Firmware ↔ wiring consistency (pin numbers used in code) arrives with static analysis in Phase 7.

## Next: Phase 4 — Tracks
