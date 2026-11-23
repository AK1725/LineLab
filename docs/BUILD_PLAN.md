# LineLab — Build Plan for Claude Code

How to use: start a Claude Code session in the repo root and paste the **Prompt** for the current phase. Claude Code follows `CLAUDE.md`. Don't move on until every **Acceptance** item is checked.

---

## Phase 0 — Foundation

**Prompt:** "Do Phase 0 of docs/BUILD_PLAN.md. Scaffold the monorepo exactly as in BLUEPRINT §3.1, set up CI and the schemas, and stop when every acceptance item passes."

- pnpm + Turborepo, all apps/packages from BLUEPRINT §3.1 as empty-but-building workspaces.
- ESLint (typescript-eslint strict), Prettier, Vitest, Playwright, ruff/mypy/pytest for `apps/vision`.
- `packages/schema`: Zod schemas for Component, Pin, Chassis, Design, Placement, Net, Track, RunTrace, SimEvent, Finding (BLUEPRINT §4). Export JSON Schema via `zod-to-json-schema`.
- `docker-compose.yml` with postgres(pgvector), redis, S3 storage (SeaweedFS, see ADR 0002), and placeholders for api, compiler, vision, web.
- GitHub Actions `ci.yml` running `pnpm verify` and Python checks. README skeleton, LICENSE (Apache-2.0), CONTRIBUTING.md, `docs/PROGRESS.md`, `docs/adr/0001-record-architecture.md`.

**Acceptance:** `pnpm install && pnpm verify` is green locally and in CI. `docker compose up` starts the infrastructure. Schema unit tests pass on valid and invalid fixtures.

## Phase 1 — Component database + search + procedural models

**Prompt:** "Do Phase 1. Populate packages/component-db with at least 120 real components (BLUEPRINT §5.1) using datasheet-accurate pins, dimensions, mass and electrical specs, with sources. Build procedural 3D generators and a search UI."

- One JSON per component, `pnpm db:validate` with schema checks plus custom checks (unique pin ids, sources present, PWM/ADC flags for MCUs match the datasheet).
- `packages/three-models`: generators for `pcb_board`, `header_row`, `ir_sensor_array`, `gearmotor_n20`, `tt_motor`, `wheel`, `ball_caster`, `battery_lipo`, `battery_18650_holder`, `buck_module`, `edf_fan`, and `generic_box` (fallback).
- Web: `/components` page with Fuse.js search (aliases), category filters, a detail panel with a rotatable 3D preview and a pin table.

**Acceptance:** at least 120 components validate. Searching "l298", "qtr8", "n20 1000", "esp32 s3", "tb6612" returns the right item first (test). Every component renders a model with no console errors (Playwright loops through all of them).

## Phase 2 — 3D assembly + chassis

**Prompt:** "Do Phase 2: the 3D assembly editor and chassis system (BLUEPRINT §5.2, §5.3)."

- Scene, cameras, grid, snapping, gizmo, multi-select, undo/redo, collision highlighting, CoG marker, dimension overlays (wheelbase, lookahead, sensor clearance).
- 6 chassis templates as data. Custom chassis outline editor, holes, material → mass/CoG. DXF/STL export, SVG/DXF/STL import.
- Design persistence: local IndexedDB (guest) plus JSON export and import.

**Acceptance:** a user can build a full 2WD robot from a template in under 3 minutes (scripted e2e). Undo/redo is correct over 100 operations (test). CoG is computed correctly against a hand-calculated fixture. 60 fps with 60 parts (perf test).

## Phase 3 — Wiring + rules engine

**Prompt:** "Do Phase 3: netlist editor (2D schematic + 3D wires) and the rules engine with at least 30 electrical and 10 mechanical rules (BLUEPRINT §5.4)."

- Click pin → pin to create nets. Pin tooltips. Templates ("wire TB6612 to Nano the standard way").
- Rules run on every change (debounced, under 50 ms for a typical design). A findings panel with severity, explanation, highlight-in-scene, and one-click fix where possible.
- Export wiring diagram PNG/PDF and a KiCad-compatible netlist.

**Acceptance:** each rule has triggering and non-triggering tests. Fixture designs `good_nano_tb6612_qtr8`, `bad_no_common_ground`, `bad_esp32_adc2_wifi`, `bad_9v_battery`, and `bad_5v_into_pico` produce exactly the expected findings.

## Phase 4 — Tracks

**Prompt:** "Do Phase 4: track model, 15+ built-in tracks, the spline track editor, and the image-to-track pipeline in apps/vision (BLUEPRINT §5.5)."

- Track geometry library (arc-length parameterization, closest-point queries, progress along the path), rasterized reflectance map.
- Vision endpoint `POST /track/from-image` returning Track JSON plus a confidence score. The editor UI for corrections and scale calibration.

**Acceptance:** geometry tests (closest point, progress monotonic along the path). Image pipeline: 10 test photos/scans in `apps/vision/tests/fixtures` reconstruct to within 5 mm average path error of the ground truth after calibration.

## Phase 5 — Simulation core + run viewer

**Prompt:** "Do Phase 5: packages/sim-core per BLUEPRINT §5.6 (motor, battery, drive, sensor models, deterministic 1 kHz loop, Monte Carlo) and the Run tab. Use a built-in TypeScript reference PID controller until firmware emulation exists."

- Web Worker host, transferable buffers, playback 0.1×–4×, timeline scrubber, plots (lateral error, sensor values, PWM L/R, battery voltage), camera follow, ghost overlay of two runs.
- Headless runner: `pnpm sim --design d.json --track t.json --controller ref --seeds 1..50`.

**Acceptance:** determinism golden test (same seed → identical trace hash). Physics property tests. The reference controller completes all easy tracks and fails hard ones in plausible ways. `pnpm bench:sim` ≥ 20× real time.

## Phase 6 — Firmware runtime

**Prompt:** "Do Phase 6: apps/compiler (sandboxed arduino-cli; returns hex, elf, a DWARF line table as JSON, and a symbol table), the avr8js and rp2040js adapters in packages/firmware-runtime wired to sim-core peripherals, and the lfr-hal WASM shim for ESP32/STM32 (BLUEPRINT §5.7)."

- Peripheral bridges: ADC, GPIO, Timer PWM → duty cycle, millis/micros, Serial → console panel.
- PC → source line mapping, live variable watch from SRAM symbols, a loop-period profiler.
- Monaco code tab with a board selector, compile errors mapped to lines.

**Acceptance:** `examples/firmware/good_pid.ino` on an emulated Nano completes the oval and figure-8. `blink.ino` timing is accurate within 1%. Compiler container has no network (test that a fetch inside the job fails) and enforces a 60 s and 1 GB limit. Fixture sketches for ESP32 run via the HAL with an "approximate" badge.

## Phase 7 — Failure detection + static analysis + run report

**Prompt:** "Do Phase 7: all failure detectors and metrics (BLUEPRINT §5.6), Monte Carlo robustness, clang-tidy/cppcheck plus custom LFR lint rules (§5.7), and the Run Report UI with events linked to time and code line."
**Acceptance:** each buggy fixture sketch in `examples/firmware/` (at least 12: no derivative, P too high, blocking delay, integer PID math, missing integral clamp, wrong pin numbers, inverted motor direction, no line-lost recovery, millis overflow, saturating PWM, wrong sensor order, uncalibrated thresholds) triggers its expected event or lint rule with the correct source line. `good_pid.ino` produces no error-level events.

## Phase 8 — AI debug agent + verification gate + feedback

**Prompt:** "Do Phase 8: packages/agent and /agent/sessions per BLUEPRINT §5.8 using @anthropic-ai/sdk with streaming, adaptive thinking, the tool set listed, and the verification gate enforced in code. Add the diff view, full corrected file, before/after metrics, ghost replay, and the real-test feedback form that restarts the loop."

- Prompt caching for the system prompt and tools. Iteration cap. Token budget per session. Refusal and `stop_reason` handling. BYO-API-key option for self-hosters.
- Offline eval: `pnpm eval:agent` runs all buggy fixtures and reports fix rate, iterations, and tokens.

**Acceptance:** at least 80% of the fixture bugs get fixed through the gate within 5 iterations. No unverified patch is ever shown (test with a mocked model returning a bad patch). The e2e path build → code → run → fail → fix → re-run passes, using a recorded model response.

## Phase 9 — Real-world loop

**Prompt:** "Do Phase 9: packages/telemetry-lib (Arduino library + binary protocol), the Web Serial/Bluetooth bridge, browser flashing (avrgirl/esptool-js/UF2), twin calibration worker (CMA-ES over twin parameters), and the PID auto-tuner (BLUEPRINT §2.2 A, B, F, §5.9.1)."
**Acceptance:** recorded real-robot telemetry fixture → calibration reduces sim-vs-real trace error by at least 40%. The auto-tuner improves lap time on a fixture design without lowering robustness.

## Phase 10 — Photo → design

**Prompt:** "Do Phase 10 per BLUEPRINT §5.10: guided multi-photo upload, detection (Claude vision bootstrap behind an interface so a YOLO model can replace it), DB matching with top-3 choices, scale/placement estimate, chassis outline, and a pre-filled netlist that the user confirms net by net."
**Acceptance:** on 5 fixture robot photo sets, at least 80% of major components are identified in the top 3, and the user can reach a valid design with only confirmations and drags (e2e).

## Phase 11 — Knowledge base, gallery, polish, launch

**Prompt:** "Do Phase 11: pgvector fix knowledge base with an opt-in privacy model, synthetic bug-injection data generator, gallery with fork/share, auth, BOM/cost report, learn-mode tutorials, PWA offline, i18n scaffolding, accessibility pass, README with hero GIF and architecture diagram, demo deployment config."
**Acceptance:** Lighthouse ≥ 90 for performance, accessibility, and best practices on the home and run pages. axe has no critical issues. `docker compose up` runs the full product on a clean machine following the README alone.

---

## Tips for the Claude Code sessions

- Start each session with: "Read CLAUDE.md, docs/BLUEPRINT.md, docs/BUILD_PLAN.md and docs/PROGRESS.md, then continue Phase N."
- For big phases, ask Claude Code to write a short plan first (plan mode), review it, then let it implement.
- Run `/code-review` before merging each phase branch.
- Keep a real robot and a printed track handy from Phase 6 on. Real fixtures (photos, telemetry logs, a video of the failure) are what make this project credible.
