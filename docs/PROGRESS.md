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

## Phase 4 — Tracks ✅ (branch `phase-4-tracks`)

**Done**

- `sim-core` track library:
  - `segmentPoints`/`sampleTrack` give an arc-length parameterisation.
  - `TrackField` is a spatial hash grid. It provides `closest`, `onLine`, `reflectanceAt` (gaps and inverted bands included), `at(s)` and `bounds`.
  - `ProgressTracker` tracks progress along the path with a windowed search and lap counting.
  - `TrackBuilder` builds a track from lines and arcs.
  - `validateTrackGeometry` checks continuity unless the track has junctions, that every arc radius is at least the line width, feature spans, and that the start pose is on the line.
  - Decisions are recorded in [ADR 0005](adr/0005-analytic-track-field.md).
- **18 built-in tracks** (`tracks/`, generated by `pnpm --filter @linelab/sim-core tracks:generate`):
  - oval, circle, figure-eight (with a crossing), S-curves, right angles, acute angles, dashed, inverted, thin line, wide and gentle, long straight, hairpins, chicane, zig-zag, spiral, sprint, a seeded random course, and a maze grid with junctions.
  - `pnpm db:validate` now also checks track geometry.
- `apps/vision`: `POST /track/from-image`.
  - Pipeline: four-corner perspective rectification (or a known mm/px), illumination correction, Otsu threshold, morphology, skeleton, graph tracing with junction detection, and Douglas–Peucker simplification.
  - Returns Track JSON plus diagnostics: line width, length, number of pieces, junctions, warnings, and an IoU **confidence** score.
- Web:
  - `/tracks` shows the built-in and saved tracks.
  - `/tracks/[id]` is a static detail page with a to-scale SVG, stats, "copy to my tracks" and JSON download.
  - `/tracks/edit` is the step editor. It has live preview, validation messages, black-on-white or white-on-black, and saves to IndexedDB.
  - `/tracks/import` takes a photo: click four corners or enter a scale, view the result and diagnostics, then save and open it in the editor.
  - A Next.js proxy (`/api/vision/track-from-image` → `VISION_URL`) returns a clear 503 when the vision service is down.

**Verified locally**

- sim-core track tests (14):
  - closest point against brute force, as property tests;
  - progress increases monotonically along the path and counts laps;
  - gaps and inversions in `reflectanceAt`;
  - the builder closes loops;
  - validation catches broken tracks.
- Vision (16 pytest tests): **10 synthetic photos reconstruct within 5 mm mean path error**, with perspective, lighting gradient, noise, blur and JPEG. There are also tests for a top-down scan, error cases and the HTTP endpoint. ruff and mypy (strict) are clean.
- Real stack, by hand: a generated S-curves photo went through `next start` and the proxy to `uvicorn`. It came back as one path, 2.27 m long and 21 mm wide (truth: 19 mm), with 0.97 confidence. With the service stopped, the proxy returned 503 and its message.
- e2e (4 new tests): the library and a detail page; the editor (a too-tight radius is rejected and Save is disabled; saving and reloading restores the steps); photo import with corner clicks (vision response mocked; the form fields were checked); and the error message.

**Deferred / known issues**

- **Not yet measured on real phone photos**; only synthetic ones (ADR 0005). Glare, creases and tape seams are likely to lower accuracy.
- Imported tracks can't be reshaped point by point. You can rename them and change the line width, or redraw them with steps. There's no editing UI for Bézier segments.
- No "this line is 19 mm wide" scale calibration (corners or mm/px only). Each track has a single line width.
- Gaps aren't detected in photos (a dashed line comes back as several pieces with a warning).

## Phase 5 — Simulation core and run viewer ✅ (branch `phase-5-sim`)

**Done**

- `sim-core` physics (decisions and assumptions are in [ADR 0006](adr/0006-simulation-model.md)):
  - a seeded xoshiro128** PRNG;
  - DC motor model from datasheet numbers;
  - battery: OCV curve per chemistry, internal resistance, SoC;
  - driver voltage drop and current limit;
  - differential drive with tyre slip, a friction circle, caster drag and CoG-based load split;
  - IR sensor model: footprint, height fall-off, ambient light, noise, quantisation, latency, and analog/digital/RC outputs;
  - brownout with MCU reset.

  `buildRobotModel` turns a design into all of this, or throws `SimSetupError` listing the missing parts.

- `Simulation` runs at a fixed 1 ms tick with automatic sub-stepping. It records a packed `Float64Array` trace (transferable) and reports the outcome (finished / off track / stuck / timeout), events (laps, brownout, off track, stuck) and metrics (completion, lap time, mean/max lateral error, oscillation, energy, loop rate). `toRunTrace` converts the trace to the schema's `RunTrace`.
- **Monte Carlo** (`runMonteCarlo`) randomises friction ±20 %, sensor noise, ambient light, battery SoC, motor mismatch ±5 % and start pose, and reports robustness.
- **Reference PID controller** behind the `Controller` interface that firmware emulation will also implement.
- Headless runner: `pnpm sim -- --design d.json --track oval --controller ref --seeds 1..50 [--trace run.json] [--json]`.
- Benchmark: `pnpm bench:sim` fails below 20× real time and runs in CI.
- Web **Run** tab in the editor. The simulation runs in a Web Worker and the trace comes back as a transferable buffer. The tab has:
  - track picker (built-in and saved), seed, Monte Carlo 10/25/50, PID gains;
  - 3D replay with top and follow cameras;
  - play/pause, 0.1×–4× speed and a scrubber;
  - plots of lateral error, sensors, PWM L/R and supply voltages (click to seek);
  - a results panel with clickable events and a Monte Carlo table;
  - a **ghost** of the previous run on the same track;
  - a clear message when a design is missing parts.
- Track-geometry validation moved from `component-db` to `sim-core` (breaks a package cycle; still part of `pnpm db:validate`).

**Verified locally**

- sim-core: 44 tests.
  - Determinism: same seed → identical trace, plus a golden hash.
  - Motor: no-load speed and stall torque match the datasheet; property tests for current limit and linear torque.
  - Battery curve is monotonic; I·R sag.
  - Sensor contrast, height fall-off, comparator, RC and ambient light.
  - Physics properties: straight with equal duties, more duty → faster, turns toward the slower wheel, mirror symmetry, stays still at zero duty, reverses, kinetic energy < battery energy, top speed close to the motors' no-load speed.
  - Robot model from the real component data, and the error listing missing parts.
- Reference controller:
  - finishes **every easy track**: 100 % over 8 Monte Carlo seeds each;
  - finishes every medium track;
  - fails expert tracks plausibly: on acute angles it loses the line _at a corner_; at maze junctions it averages two branches and stops making progress;
  - hairpins and the spiral (hard) also fail;
  - dashed, inverted, right angles (hard) and sprint (expert) pass.
- `pnpm bench:sim`: 43× real time overall, slowest single run 22×.
- e2e (3 new tests):
  - reference robot on the oval finishes in about 4.7 s; playback speed, scrubbing, seek by event, follow camera; a second run shows the first as a ghost; 10-seed Monte Carlo table; no console errors;
  - an empty design lists what's missing;
  - acute angles fails with an event.

Screenshots: [top view](screenshots/phase-5-run-top.png), [follow camera](screenshots/phase-5-run-follow.png).

**Deferred / known issues**

- Fan downforce: no thrust data in the database, so it isn't simulated. The run notes say so.
- Load transfer under acceleration, wheel inertia coupling between wheels, PWM ripple, motor inductance and encoder/IMU outputs aren't modelled yet. Encoders and IMU come with firmware emulation (Phase 6), when code can read them.
- The ghost is drawn from its own design but only for the same track. Two arbitrary saved runs can't be compared yet (no run storage until the API is used in Phase 8/11).
- The camera follow is a simple chase camera; no orbit while replaying.

## Phase 6 — Firmware runtime ✅ (branch `phase-6-firmware`)

**Done**

- **`apps/compiler`**: sandboxed compile service (`POST /compile`). Decisions are in [ADR 0007](adr/0007-firmware-runtime.md).
  - AVR boards build with arduino-cli and return the HEX, the DWARF line table, and symbols with variable types from DWARF.
  - Other boards build with clang → wasm32 against `lfr-hal`.
  - gcc/clang diagnostics are mapped to sketch lines. Prototypes are generated like the Arduino preprocessor does.
  - Docker image with the toolchains baked in. It sits on an internal-only network in docker-compose with 1 GB, 2 CPUs, a read-only root, no capabilities and a non-root user. Each job also gets prlimit and a 60 s timeout.
  - `scripts/sandbox-check.sh` runs in CI.
- **`packages/lfr-hal`**: a simulated Arduino core for the HAL tier. GPIO, ADC, PWM, ESP32 LEDC (both APIs), time, Serial with printf, String, a libc subset, math through the host, STM32 pin names. Unsupported calls fail at link time with a clear message.
- **`packages/firmware-runtime`**:
  - netlist → wiring resolution, covering sensors to MCU pins and MCU pins through 11 motor-driver logic models to wheels, polarity included;
  - ATmega328P emulation (avr8js): ADC, GPIO, timers with **PWM from registers**, USART, RC sensors;
  - profiler mapped to source lines and files, typed variable watches, loop-period measurement, brownout = MCU reset;
  - `HalRunner` for WebAssembly sketches: time advances through HAL calls; brownout restarts the sketch.
- Examples in `examples/firmware`: `good_pid.ino` (Nano), `blink.ino`, `esp32_pid.ino`. Their artifacts were built by the real compiler and are committed, so tests and the web app can run them without a compiler service.
- Web:
  - **Code** tab: Monaco bundled locally with C++ highlighting; board and tier badge; examples; Compile through `/api/compile` (503 with instructions if the compiler isn't running); errors as markers and a clickable list; warnings and log; the sketch is saved per design.
  - **Run** tab: Controller = Reference PID or My firmware (enabled only when the current source is compiled). Results show the tier badge, serial console, measured loop period, where the CPU spends its time, typed variable plots and wiring problems. A 60 s watchdog stops a HAL sketch that never yields.

**Verified locally**

- firmware-runtime (19 tests):
  - `good_pid.ino` on an emulated Nano **completes the oval and the figure-8** (loop ≈ 1.48 ms; profile: 50 % in analogRead's busy wait);
  - **blink toggles every 500 ms within 1 %**;
  - **`esp32_pid.ino` runs on the HAL and completes the oval**;
  - wiring resolution, including swapped motor wires (reverses that wheel) and a floating STBY (robot can't drive);
  - the logic tables of 5 driver types;
  - typed watches read the right values;
  - firmware runs are deterministic.
- compiler: 13 tests. Parsers (diagnostics, line table, nm, DWARF types, sizes, prototypes); job timeout and memory kill; clean environment; request validation; real AVR and HAL compiles with errors mapped to lines (these run where the toolchains are installed).
- **Sandbox, inside the real container** (internal network, 1 GB, read-only, non-root):
  - a job's network access fails (`EAI_AGAIN`, no DNS);
  - a spinning job is killed at its limit;
  - a 2.5 GB allocation is killed;
  - arduino:avr and HAL compiles work offline.

  `selfcheck.js` passes all 5 checks. The network probe uses `node:https`: `fetch` can't start under the 1 GB address-space limit (its WebAssembly parser), which would have passed for the wrong reason. Locally the image was built with this environment's proxy CA injected; the committed Dockerfile is unchanged, and CI runs the same script.

- e2e (4 new tests):
  - the Nano PID sketch runs from the Run tab, with serial, loop period, profile and the `lastError (i32)` watch, and no console errors;
  - compile errors (mocked compiler) mark the line, and editing invalidates the build;
  - the ESP32 sketch runs with the "Approximate (HAL)" badge;
  - the compile proxy returns 503 when the compiler is down.

  Full suite: 159 passed.

Screenshots: [Code tab](screenshots/phase-6-code.png), [firmware run](screenshots/phase-6-firmware-run.png).

**Deferred / known issues**

- **rp2040js emulation** isn't built. RP2040, Mega 2560, 32U4 and Nano Every run on the approximate HAL tier, labelled as such. The compiler image would need the arduino-pico toolchain for RP2040.
- HAL: no interrupts (encoders), `pulseIn`, `tone` or hardware timers. No line mapping, profiler or variable watch for WebAssembly sketches yet.
- Brake and coast both apply 0 V (the motor model has no open circuit). Encoder and IMU signals aren't fed to firmware yet.
- Emulated firmware runs at about 2.8× real time, so a 50-seed Monte Carlo with firmware takes minutes. The ≥ 20× benchmark applies to the reference controller.
- Library support on the emulated tier is whatever arduino:avr ships. No third-party libraries are installed in the compiler image yet (e.g. QTRSensors).

## Next: Phase 7 — Failure detection, static analysis, run report
