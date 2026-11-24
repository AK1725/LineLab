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

## Phase 7 — Failure detection, static analysis and run report ✅ (branch `phase-7-report`)

**Done** ([ADR 0008](adr/0008-failure-detection-and-run-report.md))

- **Detectors** (`sim-core/src/detect`): pure functions over the trace, each with an explanation:
  - line lost/reacquired;
  - oscillation (dominant frequency; P-too-high vs D-too-low);
  - PWM saturation;
  - missed turn;
  - blocking delay;
  - loop jitter;
  - infinite loop;
  - integrator windup;
  - wrong motor direction;
  - inverted steering;
  - brownout, off track and stuck explained.

  New trace channels: `lineSeen`, `distanceMm`.

- **Source lines**: the emulator records calls from the sketch into the Arduino core that block ≥ 5 ms (call site from the program counter), and stalls without sensor reads. Other events get a "likely" line by pattern.
- **`packages/firmware-lint`**: 11 line-follower rules, including pin-vs-netlist mismatches through helper parameters. They run live in the Code tab.
- **Compiler `/analyze`**: cppcheck + clang-tidy in the sandbox, mapped to sketch lines; shown in the Code tab after each compile.
- **`packages/run-report`**: one report per run (events + lines + lint + metrics).
- **12 buggy fixtures** in `examples/firmware/buggy/` with artifacts compiled by the real toolchain and an `expected.json`: no derivative, P too high, blocking delay, integer PID maths, missing integral clamp, wrong pin numbers, inverted motor, no line-lost recovery, millis overflow, saturating PWM, wrong sensor order, uncalibrated thresholds.
- Web:
  - **Run report** in the Run tab:
    - error/warning counts;
    - events with explanation, time (click to seek) and source line (click to open the Code tab at that line; "(likely)" when found by pattern);
    - the sketch's lint findings;
    - Markdown download.
  - **Static analysis** panel in the Code tab (LineLab rules live, cppcheck/clang-tidy after a build) with editor markers.

**Verified locally**

- **Acceptance**: every one of the 12 buggy fixtures triggers its expected event or rule at the right line. Each line is also checked by a fragment of its text, e.g. `delay(25)` at 69, `setMotor(PWMB, BIN2, BIN1` at 68, `PWMA = 9` at 13.
- **`good_pid.ino` has no error-level events and no findings on the oval, figure-8 and right-angles.** On right-angles it loses the line 5 times and recovers each time (warnings).
- Tests:
  - sim-core: 62, including 18 detector tests (trigger/non-trigger each);
  - firmware-lint: 16;
  - run-report: 16 (the fixture harness);
  - compiler: 16 (with cppcheck/clang-tidy parsers and a real run where installed);
  - firmware-runtime: 19.
- Real cppcheck 2.13 and clang-tidy 18 find an out-of-bounds index, an uninitialised variable and an integer division at the right sketch lines. good_pid and esp32_pid come out clean.
- e2e (2 new tests):
  - the blocking-delay sketch is flagged live by the lint, compiled (mocked compiler serving the real artifact), and run; the report shows the error with its line; the Markdown export names `sketch.ino:69`; the line link opens the Code tab at line 69;
  - a reference run on acute angles gets explained events.

Screenshots: [run report](screenshots/phase-7-run-report.png), [static analysis](screenshots/phase-7-static-analysis.png). The compiler image (with cppcheck and clang-tidy) passes all 6 sandbox self-checks, including offline analysis.

**Deferred / known issues**

- `wdt_reset` isn't detected (no watchdog model). Infinite loops on the HAL tier are caught only by the worker watchdog, not with a line.
- Pattern-based lines are heuristics, labelled "(likely)". The lint isn't a C++ parser.
- The "Approximate" HAL tier has no exact source lines (no line table for WebAssembly yet).
- Smoothness score from the blueprint's metric list isn't computed.

## Phase 8 — AI debug agent ✅ with one acceptance item not measured (branch `phase-8-agent`)

**Done** ([ADR 0009](adr/0009-ai-debug-agent.md))

- **`packages/agent`**: a streaming Messages API tool loop with `@anthropic-ai/sdk` 1.7:
  - model `claude-opus-5-5` from config;
  - adaptive thinking with summaries; effort `high` from config;
  - prompt caching (system + tools, and the conversation);
  - strict tools with eager input streaming, validated with Zod;
  - server-side refusal fallback;
  - stop-reason handling (refusal, max_tokens, context window, pause);
  - iteration cap 5, token budget, turn cap.
- **Tools**: get_firmware, get_design_summary, get_netlist, get_run_report, get_trace_window, static_analysis, compile, simulate, search_fix_knowledge, propose_patch.
- **Verification gate in code**:
  - the patch applies cleanly and compiles;
  - robustness and completion don't drop on the user's seeds + 2 fresh seeds;
  - no new error event type on any seed and no new lint rule;
  - and something measurably improves.

  The user sees only accepted patches: the regenerated diff, the full file, before/after on every seed, and the compiled firmware. Code in the model's text is removed.

- **`apps/api`**: `POST /agent/sessions`, `GET …/events` (server-sent events), `GET …/:id`, `POST …/stop`, `POST …/feedback`. Per-IP rate limits, bring-your-own key (never stored), compiler service + compile cache. Feedback: "worked" stores a confirmed case; "didn't work" starts a new round from the fixed sketch with the observations.
- **Web**: "Debug with AI" in the Run tab, shown for firmware runs:
  - streamed reasoning summary and tool activity;
  - rejected attempts with the gate's reasons;
  - the diagnosis;
  - the verified fix (before/after table, coloured diff, full file);
  - "Use this version and re-run", where the previous run becomes the ghost;
  - the real-track feedback form;
  - an own-key field.
- `pnpm eval:agent`: live-model eval over all 12 fixtures (fix rate, attempts, tokens, `--record` transcripts). A reference fix (`fix.diff`) for every buggy fixture. A compile cache of real compiler output (`examples/firmware/.compile-cache`).

**Verified locally**

- **Gate**: the reference fix for **all 12 fixtures passes the gate**. It rejects a patch that doesn't compile, a no-op patch, and a patch that reverses a working motor (naming the new errors).
- **No unverified patch is ever shown** (mocked model): a bad patch (`delay(25)` → `delay(20)`) is rejected ("nothing measurably improved"), the session ends `not_fixed`, there is no `verified` event, and the code the model put in its final text is removed.
- Also tested:
  - iteration cap;
  - refusal (tools of the refused turn not run);
  - token budget stop;
  - invalid tool input;
  - the exact SDK request (model, caching breakpoints, adaptive thinking, effort, fallbacks, strict + eager tools).
- API (8 tests): SSE session to a verified patch; 503 with no key and a user's own key passed through; rate limit; feedback storing a confirmed case and restarting a round.
- **e2e** (`agent.spec.ts`): build → code → run → fail (blocking delay) → AI fix verified → re-run with ghost and 0 errors → "didn't work" feedback → round 2 honestly ends "No verified fix found". The model side is a **scripted transcript** (`examples/agent`, labelled in the UI); the API, compile outputs, simulator and gate are real.

Screenshot: [AI debugger with a verified fix](screenshots/phase-8-ai-debugger.png) (scripted transcript).

**Not verified: the "≥ 80 % of fixture bugs fixed through the gate within 5 iterations" criterion.** This environment has no Anthropic API key, so the live-model eval has not been run. To measure it: `ANTHROPIC_API_KEY=… ARDUINO_CLI=… pnpm eval:agent`. The script exits non-zero below 80 %. What is shown is that every fixture is fixable within the gate's rules (12/12 reference fixes accepted).

**Deferred / known issues**

- Sessions and the fix knowledge are in API memory (lost on restart); pgvector retrieval and persistence come in Phase 11.
- `simulate` runs on the user's track only (not other tracks).
- The scripted transcript is hand-written. Record real ones with `pnpm eval:agent -- --record`.

## Phase 9 — Real-world loop ✅ with the real-robot fixture still to collect (branch `phase-9-real-world`)

**Done** ([ADR 0010](adr/0010-real-world-loop.md))

- **`packages/telemetry-lib`**:
  - the `LineLabTelemetry` Arduino library: sample, hello and text frames, CRC-16, any `Print` (Serial, Serial1, BLE UART);
  - the TypeScript codec: streaming `FrameDecoder` that handles any chunking, skips `Serial.print` noise and counts bad frames; `encodeFrame`;
  - `RecordingBuilder`, which unwraps the micros() wrap;
  - `examples/firmware/telemetry_pid` (good_pid plus telemetry).
- **Compiler**: bundled Arduino libraries (`LINELAB_ARDUINO_LIBRARIES`, `--library`; HAL tier compiles the library sources). The Docker image ships the library.
- **Schema**: `TelemetryRecording` and `TelemetrySampleRecord`; a `set-calibration` design command (undoable).
- **sim-core**: twin sensor gain, offset, noise and latency (`RobotModel.sensorTwin`). Uncalibrated designs are unchanged, and the golden hash is the same.
- **`packages/calibrate`**:
  - CMA-ES and GP + expected-improvement Bayesian optimisation, plus Jacobi eigen and Cholesky helpers;
  - `calibrateTwin`: a closed-loop replay of the recorded controller. It compares low-passed sensors and PWM, searches the clock offset, and adds a noise-level term. It reports error before and after on the fit window and on a held-out window;
  - `autotunePid`: kp, kd, base duty and corner slowdown over Monte Carlo seeds, with a robustness penalty and a held-out re-check;
  - `syntheticRecording`.
- **Web, new Robot tab**:
  - **Connect**: USB serial (Web Serial, any baud) or Bluetooth (Nordic UART, HM-10).
  - **Live telemetry**: sensor bars, motor-command plot, variable plot, battery, text log, frame statistics.
  - **Record and recordings**: record, download, and load recordings, plus a clearly labelled synthetic demo.
  - **Flash**: Uno, Nano (115200 / 57600) and Pro Mini over STK500, with verify. The port is reopened at the bootloader's baud and back again.
  - **Calibrate twin**: in a worker, against the reference PID or the compiled AVR sketch. "Apply to design" sets the calibration, and it can be removed.
  - **Auto-tune PID**: in a worker. "Use in simulator" sets the Run tab's PID.

**Verified locally**

- **Emulated round trip**: the arduino-cli build of `telemetry_pid`, running on the emulated ATmega328P, gives a hello frame and about 195 CRC-valid samples in 2 s (mean period 10 ms, 0 bad frames). Their PWM matches what the simulator read from the timers (< 0.01). Their sensors match the emulated ADC (mean 6.7 counts apart, 1 ms later).
- **Calibration acceptance**, on the **synthetic** hidden-twin fixture (not hardware data; see below): trace error is **64 % lower** on the fit window (0–3 s) and **56 % lower** on the held-out window (3–5 s). Sensor gain is recovered as 0.74 (true 0.78) and offset as 0.047 (true 0.06). The run takes 160 simulations, about 15 s. The test requires at least 40 % on both windows.
- **Auto-tuner acceptance**: reference robot on `random-curvy`. Held-out lap time goes from **4.11 s to 3.17 s** (−23 %). Robustness stays at 100 % on the 4 tuning seeds and the 6 held-out seeds. The run takes 30 evaluations, about 9 s.
- **Flasher**: unit tests against a software Optiboot cover these cases:
  - page writes with 0x20 inside the data;
  - verify catches a stuck bit;
  - a wrong signature is refused;
  - a bootloader that never answers produces a hint that names 57600;
  - a bootloader-overlap guard;
  - hex extent.
- **e2e** (`robot.spec.ts`), with a mocked `navigator.serial` that has a fake Nano behind it:
  - connect, hello, live plots;
  - record, then download the recording;
  - flash the compiled `telemetry_pid`: DTR reset, STK500 at 115200, verify, and the fake's flash holds the image;
  - telemetry resumes after flashing;
  - no console errors.

  A second test loads the synthetic demo, calibrates it in the browser worker (≥ 40 %), applies it to the design, auto-tunes, and sends the tuned gains to the Run tab.

- **Compiler container**: the rebuilt `apps/compiler` image compiles `telemetry_pid` with the bundled library for the Nano (5436 bytes, same as the local toolchain) and on the HAL tier (RP2040). The selfcheck passes 6/6.
- Found and fixed: `parseIntelHex` pads unwritten flash with 0x00, not 0xFF, so flashing now sizes the image from the hex records.

Screenshot: [Robot tab](screenshots/phase-9-robot-tab.png). It shows the fake serial device and a calibration of the synthetic demo in the browser: 64 % lower, 55 % lower held out. The fitted values differ slightly from the Node run because Chrome's and Node's V8 can round `Math.exp`/`sin` differently, so CMA-ES takes a different path.

**Not verified: a real-robot recording.** The build plan asks for a _recorded real-robot_ fixture. None exists in this environment, which has no hardware. The calibration test uses a synthetic recording: the simulator with hidden parameters and a different noise seed. It is labelled `synthetic` everywhere. This shows that the optimiser, objective and pipeline work. It says nothing about how well the twin model matches real robots. To close this item: record a run with `telemetry_pid`, download it from the Robot tab, add it under `packages/calibrate/fixtures/`, and add it to `calibrate.test.ts`.

**Deferred / known issues**

- Coming soon (shown in the UI):
  - flashing for ESP32 (esptool-js), RP2040 (UF2) and STM32;
  - tuning the gains inside the user's own sketch (the tuner tunes the reference PID).
- Browser flashing has been exercised only against the fake bootloader, not a physical board.
- The Web Bluetooth path is untested beyond type-checking. Playwright can't fake GATT easily, and there is no device here.
- Motor strength and driver drop trade off against each other in calibration. Encoder counts are in the protocol but not yet in the objective.
- Calibration runs in a browser worker; the BullMQ worker version (BLUEPRINT §3) is not wired up.

## Phase 10 — Photo → design ✅ with the live detection metric not measured (branch `phase-10-photo-design`)

**Done** ([ADR 0011](adr/0011-photo-to-design.md))

- **Schema**: `PhotoView`, `PhotoBox`, `PhotoDetection`, `DetectionResult`, `PhotoSetTruth`.
- **`packages/photo-design`**:
  - **`PhotoDetector` interface**, with three detectors:
    - `ClaudeVisionDetector`: SDK, images and structured JSON output, adaptive thinking, model and effort from env, refusal and truncation handling, Zod re-validation;
    - `ScriptedDetector`;
    - a YOLO slot.
  - **`matchDetections`**: top-3 database parts per detection.
  - **`proposeDesign`**:
    - scale from parts of known size;
    - the axle frame;
    - a custom chassis from the silhouette, clipped inside the wheels, with the caster behind the sensor; or the nearest template;
    - photo positions for parts on the deck;
    - an auto-wired netlist to confirm.
  - **`syntheticTopView`**: an ideal overhead camera for tests and fixture renders.
- **`apps/vision` `POST /robot/outline`**: robot silhouette with OpenCV. The background is taken from the image border; nearby regions are merged; the outline is simplified to a polygon.
- **`apps/api` `POST /photo/detect`**:
  - up to 8 photos; a top view is required;
  - base64 validated;
  - per-IP limit;
  - the user's own key, or the server key;
  - `LINELAB_PHOTO_SCRIPT` replay.
- **Web**: "Start from photos" on the Build page, then the `/build/from-photos` wizard:
  - **Photos**: guided-capture tips, a view per photo, and an own-key field.
  - **Parts**: the top 3 plus "not on my robot", and a count, shown beside the top photo with the outline and boxes. Non-model detections carry a banner.
  - **Chassis & layout**: from the photo or a template, with explained notes.
  - **Wiring**: Confirm or Skip per net, with live rule-check errors.
  - **Create design**, which opens the editor, where every part can be dragged.
- **Five fixture robots** (real parts, rules-clean): Nano/TB6612/QTR-8A, Uno/L9110S/TT, ESP32/DRV8833/QTR-8RC, Pico/DRV8835/QTR-MD, Pro Mini/MX1508/TCRT5000×8. Each has truth, scripted descriptions and a top-view **render** (labelled as not a photo).
- **`pnpm eval:photos`**: the live detection metric per photo-set kind; fails below 80 %.

**Verified locally**

- **Matching**: from the scripted descriptions (written from each part's real appearance and markings, never its database name), **39/39 major components of the 5 fixture robots are in the top 3**.
- **Layout**: from an ideal top view, all five robots get:
  - the right parts;
  - scale within 5 %;
  - deck parts within 6 mm of where they really are;
  - **0 rule-check errors after confirming the proposed nets**.

  The same holds with the **vision service's actual silhouettes** of the renders, with the photo rotated (front to the right), and without a silhouette (template fallback).

- **Vision**: silhouette IoU > 0.93 on synthetic photos with a lighting gradient and noise, and > 0.9 on the five renders; clear errors for an empty frame or a non-image.
- **API**: 4 tests (detections, top view required, base64 validation, own key / no key, rate limit). Claude detector: request shape (images, views, JSON schema, adaptive thinking, model) plus refusal, truncation and invalid-JSON handling, with a mocked SDK.
- **e2e** (`photos.spec.ts`), against the real API with the scripted detector and the vision service's answer replayed:
  - upload the top render;
  - every real part is among the 3 choices and is selected;
  - chassis from the silhouette; 10 parts placed;
  - confirm each net, with 0 errors;
  - create the design, and the editor holds exactly the robot's parts, the confirmed nets and a custom chassis;
  - no console errors.

Screenshots: [parts step](screenshots/phase-10-photo-parts.png), [chassis step](screenshots/phase-10-photo-chassis.png). Both show a scripted replay over a render.

**Not verified: "≥ 80 % of major components identified in the top 3 on 5 fixture photo sets" with a live detector.** This environment has no Anthropic API key and no real robot photos. The committed sets are LineLab renders with no chip markings, which say little about real photos. To measure: add real photo sets (`photos + truth.json`, kind `"real"`) and run `ANTHROPIC_API_KEY=… pnpm eval:photos`.

**Deferred / known issues**

- No trained YOLO detector yet (it needs a labelled dataset; the interface is ready).
- Multi-view reconstruction (BLUEPRINT §5.10 step 7) is not started.
- Silhouettes need a plain, contrasting background.
- Parts on the bottom of the robot are placed by rule, not from the bottom photo.
- Chassis thickness, material and deck height are estimated (3 mm acrylic, from wheel and motor size), so the user should check them.

## Phase 11 — Knowledge base, gallery, polish, launch ✅ (branch `phase-11-launch`)

**Done** ([ADR 0012](adr/0012-launch-knowledge-gallery-auth.md))

- **Fix knowledge base**:
  - Postgres + pgvector via Drizzle (HNSW cosine index, one row per diff, confirmations counted), or memory without a database;
  - a dependency-free hashing embedder behind an `Embedder` interface;
  - **opt-in sharing**: a "Share this fix" checkbox (off by default) on confirmed fixes; only the diff, diagnosis and part names are stored;
  - the agent sees each case's provenance (confirmed on N real robots, or synthetic).
- **Synthetic bug injection** (`pnpm --filter @linelab/agent inject-bugs`): 11 mutation operators on the good sketch × 3 tracks. A case is kept only if LineLab detects a new failure, and the fix is the reverse diff. Result: **9 labelled synthetic cases** that seed an empty base (`LINELAB_KB_SEED`).
- **Accounts** (no new dependencies):
  - GitHub OAuth;
  - email magic links (one-time, hashed, 15 minutes, rate-limited; printed in the API log when self-hosting);
  - HMAC-signed cookies;
  - same-site redirects only.
- **Gallery**: publish (signed in), public or unlisted, versions, delete (author only), search, a view page with outline and BOM, fork into local designs (lineage kept), copy link. Guests keep everything local.
- **BOM**: grouped parts, mass including the chassis plate, typical prices from the database (all 124 parts have one), editable prices, CSV with formula injection defused.
- **Learn mode**: three lessons. Two open the reference robot with a real buggy sketch, straight into Run with the sketch as the controller. Step progress is saved locally.
- **PWA**: manifest, icons, a service worker; the studio works offline after one visit.
- **i18n scaffolding**: a message catalogue with English (complete) and Spanish (navigation, home, footer); a language switcher.
- **New home page**: features and entry points; Gallery and Learn added to the navigation.
- **Accessibility**: contrast (accent `#087a5a`), accessible names, landmarks, focusable scroll regions, labelled status dots.
- **Docker**:
  - the web image ships `public/`;
  - the API image ships the knowledge seed;
  - compose wires the seed, sign-in (development-only default secret, links in the log) and a shared Postgres password.
- **`scripts/smoke-compose.sh`**: checks every service, a real sandboxed compile, email sign-in, gallery publish/read/delete on Postgres, and the knowledge seed.
- **Demo deployment** (`deploy/`): Caddy with automatic HTTPS as the only published service, required secrets, lower AI limits.
- **README**: hero GIF, a Docker quick start for a clean machine, an architecture diagram.

**Verified locally**

- **Lighthouse** (`pnpm --filter @linelab/e2e lighthouse`, production build), on the home page and the run page (the reference robot opened in the Run view, confirmed from the final screenshot):

  | Page | Form factor | Performance | Accessibility | Best practices |
  | ---- | ----------- | ----------- | ------------- | -------------- |
  | Home | mobile      | 100         | 100           | 100            |
  | Home | desktop     | 100         | 100           | 100            |
  | Run  | mobile      | 99          | 100           | 100            |
  | Run  | desktop     | 100         | 100           | 100            |

- **axe** (WCAG 2.1 A/AA, `a11y.spec.ts`): **no critical or serious issues** on 10 pages, the editor, a finished run, and home and editor in dark mode.
- **`docker compose --profile apps up`** on fresh volumes, with all four app images built from the committed Dockerfiles: `smoke-compose.sh` passes everything, including the 9 seeded cases in Postgres. In a browser against the containers, the reference robot's sketch compiled in the sandboxed compiler and the emulated run finished, with no console errors.
  - The images were built here with the sandbox's proxy CA added to temporary copies of the Dockerfiles; the committed Dockerfiles need none.
  - A truly separate clean machine was not available.
- **Knowledge base**: tested against a real pgvector container (store, deduplicate, confirm, retrieve by meaning). Retrieval on the seed finds the right bug class from symptom text.
- **API**: sign-in against a fake GitHub (state check, code exchange); the full gallery flow in memory and on Postgres; opt-in sharing.
- **e2e**:
  - BOM → email sign-in → publish → gallery search → fork;
  - lesson run shows the oscillation;
  - Spanish switch persists;
  - the editor reloads offline with the design from IndexedDB.

**Deferred / known issues**

- No SMTP mailer: sign-in emails are printed in the API log (fine for self-hosting; a public demo should use GitHub sign-in).
- The embedder matches words, not meaning (bge-small needs PyTorch, which wasn't added without approval).
- i18n covers navigation, home and footer only.
- Lighthouse measures page load, not a running 3D simulation.
- No learned models (failure predictor, RL tuner; BLUEPRINT §5.9.3): they need collected data.

## After Phase 11

All phases in `docs/BUILD_PLAN.md` are built. Open items that need hardware, data or keys:

- a real-robot telemetry recording (Phase 9);
- real robot photo sets and a live detection eval (Phase 10);
- the live AI debugger fix rate (Phase 8);
- physical-board flashing and Bluetooth tests;
- an SMTP mailer.
