# LineLab — Blueprint

> An open-source, browser-based studio for designing, wiring, simulating, and debugging line-following robots (LFRs). You put together a virtual robot that matches your real one, run your real firmware against it on a virtual track, see exactly where and why it fails, and get a verified fix.

Working name: **LineLab** (rename freely).

---

## 0. Product vision in one paragraph

A user searches a component database ("TB6612", "QTR-8A", "N20 1000rpm"), drops 3D parts onto a chassis template or one they designed, and wires them up. A rules engine flags electrical and mechanical mistakes as they happen. The user pastes or uploads the firmware they flash to their robot. LineLab compiles it, **runs the actual compiled binary** in an emulated microcontroller connected to a physics-based digital twin, and drives it around a chosen or uploaded track. Failures (line loss, oscillation, stuck loops, missed 90° turns) are detected, tied to the lines of source code that caused them, and handed to an AI debugging agent. The agent proposes a fix, re-checks it across many randomized simulations, and shows a diff. The user tests on the real robot and reports back. That feedback **calibrates the digital twin** and grows a shared knowledge base of fixes.

---

## 1. Critical design decisions (read these first)

These are the choices that decide whether the project is impressive or just a toy.

| Decision                 | Choice                                                                                                                                                                                                                           | Why                                                                                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| How user code runs       | **Emulate the real compiled binary** (AVR via `avr8js`, RP2040 via `rp2040js`), with a **HAL-shim fallback** (user code compiled against a mock Arduino API, to WASM or a sandboxed native process) for ESP32/STM32/Teensy       | Asking an LLM to "imagine" how code behaves is unreliable. Running the code gives ground truth, and the LLM only explains and fixes.                                     |
| Physics                  | Custom **deterministic 2D dynamics** (differential drive + tire slip + DC motor + battery model) at 1 kHz, rendered in 3D                                                                                                        | LFRs are planar. A full 3D physics engine adds noise and nondeterminism with no accuracy gain. Determinism makes regression tests and reproducible bug reports possible. |
| Where the sim runs       | `packages/sim-core`, pure TypeScript with no DOM. Runs in a **Web Worker** in the browser and **headless in Node** for CI and batch Monte Carlo                                                                                  | One engine everywhere. A bug seen in the UI can be reproduced in a test.                                                                                                 |
| What "AI learning" means | (1) **Sim-to-real calibration** of each user's digital twin, (2) a **retrieval knowledge base** of verified bug→fix cases, (3) later, **small learned models** (failure predictor, PID auto-tuner) trained on the collected data | Fine-tuning a foundation LLM on user thumbs-up is expensive, slow, and noisy. These three loops measurably improve results.                                              |
| Fix acceptance           | A fix is shown only if it **compiles, passes N seeded simulations, and does not regress** any metric                                                                                                                             | This keeps hallucinated fixes from reaching users.                                                                                                                       |
| 3D assets                | **Parametric procedural models generated from component dimensions** by default. Licensed CC/CC0 glTF models are optional extras with attribution                                                                                | Avoids copyright problems and guarantees every DB entry has a model.                                                                                                     |
| Open data                | Component DB is plain JSON plus JSON Schema in the repo, validated in CI, open to community PRs                                                                                                                                  | The database becomes the project's network effect.                                                                                                                       |

---

## 2. Feature set

### 2.1 Your original features (kept, sharpened)

1. **Component database and search**: fuzzy search with aliases ("l298" → L298N, "qtr8" → Pololu QTR-8A/8RC), filters by category, voltage, and price.
2. **3D assembly**: drag and drop onto the chassis, snap-to-grid, mounting-hole snapping, rotate, layer (top and bottom deck), collision detection.
3. **Chassis**: a template library, a parametric custom designer, and DXF/SVG/STL import.
4. **Live validation**: electrical, mechanical, and layout errors, warnings, and tips, each with an explanation and a one-click "fix" where possible.
5. **Photo → virtual model**: multi-angle upload, component detection, proposed layout, user confirmation.
6. **Code analysis and simulation**: upload code, pick or upload a track, watch a 3D run, get failure detection.
7. **AI debug loop**: diagnose → patch → re-simulate → user tests on real hardware → feedback → learn → repeat.

### 2.2 Features to add (these lift the project a lot)

| #   | Feature                                                                                                                                                                                                                 | Value                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | **Real robot telemetry bridge** (Web Serial / Web Bluetooth). Stream live sensor values and motor PWM from the real robot into LineLab                                                                                  | The biggest upgrade. Real data replaces "it doesn't work". It feeds calibration and gives the AI real evidence. Ships with a tiny `LineLabTelemetry` Arduino library. |
| B   | **Flash from the browser** (`avrgirl-arduino`, `esptool-js`, Pico UF2 download)                                                                                                                                         | Closes the loop: fix → flash → test in one place.                                                                                                                     |
| C   | **Wiring editor + netlist** (schematic view next to the 3D view), export as PNG/PDF and as a KiCad netlist                                                                                                              | Most real LFR failures are wiring.                                                                                                                                    |
| D   | **Power budget and battery sag** (stall currents, regulator dropout and heat, run-time estimate)                                                                                                                        | Catches brownout resets, a classic "random" failure.                                                                                                                  |
| E   | **Sensor calibration simulator** (sensor height, ambient light, surface glossiness, shows raw ADC curves)                                                                                                               | Teaches _why_ calibration matters.                                                                                                                                    |
| F   | **PID / controller auto-tuner** (Bayesian optimization over Kp/Ki/Kd/base speed in simulation, then on the calibrated twin)                                                                                             | A visible "magic" feature users love.                                                                                                                                 |
| G   | **Monte Carlo robustness score** (each run under randomized noise, friction, battery level, and lighting)                                                                                                               | A single run passing proves little. "Passes 47/50" is honest.                                                                                                         |
| H   | **Ghost replay and run comparison** (overlay of two runs, timeline scrubber, plots of error, PWM, and sensors)                                                                                                          | Debugging UX like a race-car data system.                                                                                                                             |
| I   | **Track editor + competition presets** (spline track editor, presets modeled on common competition rule sets: line width, min radius, 90° turns, acute angles, crossings, dashed lines, inverted sections, checkpoints) | Lets teams practice for a specific event.                                                                                                                             |
| J   | **BOM, cost, weight report** with optional vendor links                                                                                                                                                                 | Practical for teams on a budget.                                                                                                                                      |
| K   | **Design versioning, sharing, forking** (public gallery, "fork this robot")                                                                                                                                             | Community growth and GitHub stars.                                                                                                                                    |
| L   | **Static analysis with LFR-specific lint rules** (clang-tidy/cppcheck plus custom rules)                                                                                                                                | Catches bugs before simulation runs.                                                                                                                                  |
| M   | **Learn mode**: guided tutorials ("build your first LFR", "why your robot oscillates")                                                                                                                                  | Wider audience, good for classrooms.                                                                                                                                  |
| N   | **Offline PWA + self-host via `docker compose up`**                                                                                                                                                                     | Hackathons and labs often have bad internet.                                                                                                                          |
| O   | **Maze / junction solving mode** (left-hand rule, path memory) as an advanced track type                                                                                                                                | Many competitions include it.                                                                                                                                         |

---

## 3. Architecture

```
┌──────────────────────────── Browser (apps/web, Next.js) ────────────────────────────┐
│  UI (React + Tailwind + shadcn/ui)   3D (react-three-fiber + drei)   State (Zustand) │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────┐  ┌──────────────────────┐ │
│  │ Assembly     │  │ Wiring editor │  │ Track editor     │  │ Run viewer / replay  │ │
│  └──────┬───────┘  └──────┬────────┘  └────────┬─────────┘  └──────────┬───────────┘ │
│         └──── rules-engine (pure TS) ──────────┘                       │             │
│  Web Worker: sim-core + firmware-runtime (avr8js / rp2040js / WASM HAL)─┘             │
│  Web Serial / Web Bluetooth telemetry bridge, browser flashing                       │
└───────────────────────────────┬──────────────────────────────────────────────────────┘
                                │ REST + WebSocket (tRPC or typed REST)
┌───────────────────────────────┴───────────────── Backend ────────────────────────────┐
│ apps/api (Node/TS, Fastify)   auth, projects, designs, runs, feedback, agent orchestr.│
│ apps/compiler (sandboxed)     arduino-cli / PlatformIO / emscripten → .hex/.elf/.wasm │
│ apps/vision (Python FastAPI)  track image → vector path; robot photos → detections    │
│ workers (BullMQ on Redis)     batch Monte Carlo, calibration, auto-tune, compile jobs │
│ Postgres (+pgvector)  S3 storage (uploads, models, binaries)  Redis (queue, cache)      │
│ LLM: Claude API (Anthropic SDK, TypeScript) for diagnosis, patching, vision assist    │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Monorepo layout (pnpm workspaces + Turborepo)

```
linelab/
├─ apps/
│  ├─ web/            Next.js 16 App Router, TS strict
│  ├─ api/            Fastify + Drizzle ORM + Zod, agent orchestration
│  ├─ compiler/       Docker image: arduino-cli, PlatformIO cores, emscripten; no network at runtime
│  └─ vision/         Python 3.12 FastAPI: OpenCV, scikit-image, ultralytics (YOLO)
├─ packages/
│  ├─ schema/         Zod schemas + generated JSON Schema: Component, Chassis, Design, Netlist, Track, RunTrace
│  ├─ component-db/   data/*.json (one file per component), procedural model params, seeds, validator
│  ├─ rules-engine/   pure functions: (Design) => Finding[]
│  ├─ sim-core/       deterministic physics, sensor model, track model, metrics, failure detectors
│  ├─ firmware-runtime/ avr8js + rp2040js adapters, HAL shim (C headers + JS bindings), PC→line mapping
│  ├─ lfr-hal/        C/C++ mock Arduino core + mock libs (QTRSensors, Servo, Wire subset)
│  ├─ agent/          AI debug agent: prompts, tools, patch verification loop
│  ├─ telemetry-lib/  Arduino library: LineLabTelemetry (compact binary protocol over Serial/BLE)
│  ├─ ui/             shared React components
│  └─ three-models/   procedural geometry generators (PCB, header pins, motors, wheels, sensors)
├─ tracks/            built-in track JSON + preview PNGs
├─ examples/firmware/ sample sketches, intentionally buggy ones included (test fixtures)
├─ docs/              this blueprint, ADRs, contributor guide, component-contribution guide
├─ e2e/               Playwright tests
├─ docker-compose.yml postgres, redis, S3 storage, api, compiler, vision, web
└─ .github/workflows/ ci.yml, db-validate.yml, e2e.yml, release.yml
```

---

## 4. Data model (core types, in `packages/schema`)

```ts
// Component in the database
Component {
  id: string                    // "driver.tb6612fng"
  name: string; aliases: string[]; category: Category
  manufacturer?: string; datasheetUrl?: string; typicalPriceUsd?: number
  dimensionsMm: { x: number; y: number; z: number }; massG: number
  mountingHoles?: { x: number; y: number; d: number }[]
  model: { kind: "procedural"; generator: string; params: Record<string, number> }
       | { kind: "gltf"; url: string; license: string; attribution: string }
  pins: Pin[]
  electrical: ElectricalSpec      // category-specific discriminated union
  simModel?: SimModelRef          // e.g. IR sensor response curve, motor constants
  license: "CC-BY-SA-4.0"; sources: string[]
}
Pin { id; label; kind: "power_in"|"power_out"|"gnd"|"digital"|"analog"|"pwm"|"i2c_sda"|...;
      voltageDomain?: number; maxCurrentmA?: number; adcCapable?: boolean; pwmCapable?: boolean;
      fiveVoltTolerant?: boolean; notes?: string }

Chassis { id; name; inspiredBy?: string; outline: Polygon; thicknessMm; material; densityGcm3;
          decks: Deck[]; mountPoints: Vec2[]; wheelMounts: WheelMount[]; casterMounts: Vec2[] }

Design { id; version; chassisId | customChassis; placements: Placement[]; netlist: Net[];
         firmware?: FirmwareRef; calibration?: TwinParams }
Placement { instanceId; componentId; position: Vec3; rotation: Quat; deck: number }
Net { id; name; connections: { instanceId; pinId }[] }

Track { id; name; units: "mm"; surface: { lineColor; bgColor; reflectance }; lineWidthMm;
        segments: (Line|Arc|Bezier)[]; features: (Crossing|Gap|Inversion|Checkpoint|Junction)[];
        start: Pose; finish?: Pose }

RunTrace { runId; seed; designHash; firmwareHash; trackId; dtMs; frames: Frame[];
           events: SimEvent[]; metrics: RunMetrics }
SimEvent { tMs; type: "line_lost"|"oscillation"|"stuck"|"off_track"|"brownout"|"wdt_reset"
           |"pwm_saturation"|"integrator_windup"|"missed_turn"|"lap_complete"|...;
           severity; data; sourceLoc?: { file; line; fn } }
```

---

## 5. Subsystem specs

### 5.1 Component database (`packages/component-db`)

- **Seed with 120+ components** (the minimum list is below), each with complete pins and specs from datasheets.
- **Microcontrollers:** Arduino Uno R3, Nano, Nano Every, Pro Mini (5 V/3.3 V), Mega 2560, Leonardo, ESP32 DevKitC, ESP32-S3, ESP32-C3, RP2040 Pico / Pico W, STM32F103 "Blue Pill", STM32F411 "Black Pill", Teensy 4.0, Arduino Nano 33 IoT.
- **Line sensors:** TCRT5000 single, 3/5-channel TCRT5000 boards, Pololu QTR-1A/1RC, QTR-8A, QTR-8RC, QTR-MD-xx, QTRX-HD series, generic 8-channel analog arrays, TCS34725 color sensor, CNY70, ITR20001.
- **Other sensors:** wheel encoders (N20 magnetic, optical), MPU6050/ICM-20948 IMU, VL53L0X/VL53L1X ToF, HC-SR04 ultrasonic.
- **Motor drivers:** L298N, L293D, TB6612FNG, DRV8833, DRV8835, DRV8871, MX1508, BTS7960, Pololu MAX14870.
- **Motors:** N20 / micro metal gearmotors (6 V and 12 V, 10:1 through 1000:1, LP/MP/HP/HPCB), TT/BO yellow motors, coreless 8520/720, JGA25-370.
- **Wheels and casters:** 32/40/60 mm micro wheels, silicone tires, ball casters (3/8", 1/2"), omni-wheel.
- **Power:** 1S/2S/3S LiPo (various mAh), 18650 Li-ion (1S/2S holders), AA/AAA packs, 9 V battery (flagged with a warning), LM2596, MP1584, XL6009 boost, AMS1117-3.3/5.0, LM7805, Pololu S7V8F5, power switch, fuse.
- **Extras:** HC-05/HC-06, nRF24L01, SSD1306 OLED, buzzer, push buttons, LEDs, **EDF / suction fan + ESC** (downforce racers), standoffs, battery straps.
- Every entry passes `pnpm db:validate` (JSON Schema + custom checks: pins unique, dimensions positive, sources present).
- Search: Fuse.js client-side over name + aliases + category, with Postgres `pg_trgm` server-side for the public API.

### 5.2 3D assembly editor (`apps/web`)

- react-three-fiber scene with orbit, top, and side cameras, a mm grid, snapping (grid, mounting holes, deck edges), a transform gizmo, multi-select, undo/redo (command pattern, at least 100 steps), and keyboard shortcuts.
- Collision detection with AABB plus an OBB narrow phase. Overlapping parts are outlined red.
- Live **CoG marker**, wheelbase and track-width dimension lines, sensor lookahead distance (sensor array → axle), and sensor ground clearance.
- Wires: drawn as tube splines between pin anchors, color-coded by net type (power red, ground black, signal by net).
- Performance: instanced meshes and LOD. Target 60 fps with 60 components on a mid-range laptop.

### 5.3 Chassis

- **Template archetypes**, labeled "inspired by" common competitive designs and never claiming a copy of a specific team's robot:
  1. _Starter 2WD acrylic + caster_ (beginner kits)
  2. _PCB-as-chassis lightweight racer_ (popular in top competitions: the board is the frame)
  3. _Long-nose T-frame_ (sensor array far ahead of the axle for lookahead)
  4. _Downforce / suction racer_ (EDF or fan skirt for high-speed cornering)
  5. _4WD robust_ (rough or ramp tracks)
  6. _Maze solver compact_ (short wheelbase, encoders)
- **Custom designer:** a polygon/spline outline editor, fillets, cutouts, mounting-hole pattern generator, thickness, and material (acrylic, FR4, PLA, carbon fiber, aluminium). Mass and CoG are computed. Export as DXF (laser cutting) and STL (3D printing). Import DXF/SVG/STL.

### 5.4 Rules engine (`packages/rules-engine`)

Pure functions `(design) => Finding[]` with `{ id, severity: "error"|"warning"|"tip", message, explanation, affected: refs[], fix?: Patch }`. Each rule has unit tests, including a positive case and a negative case.

**Electrical rules (examples, implement at least 30):**

- Voltage domain mismatch (5 V output → 3.3 V-only input, e.g. sensor into an ESP32 or Pico GPIO without a divider)
- Missing common ground between logic and motor supply
- `analogRead` pin wired to a non-ADC pin. ESP32 **ADC2 pins used while WiFi is on**
- Motor PWM input wired to a non-PWM pin. Timer conflicts (e.g. Uno pins 9/10 and the Servo library)
- Motor stall current > driver per-channel continuous rating (L298N voltage drop warning, TB6612 1.2 A cont.)
- Battery voltage > motor rated voltage by more than 30%. Battery below driver minimum
- Regulator dropout (LM7805 from 2S at low charge) and thermal estimate (P = (Vin−Vout)·I)
- 9 V PP3 battery as motor supply (high internal resistance → brownout)
- Unconnected required pins (driver STBY, EN). Floating inputs. Short (power net tied to GND)
- I2C address collision. Serial pins 0/1 used while Serial is used for upload/telemetry
- Firmware ↔ wiring consistency (pin numbers in code vs netlist, from static analysis)

**Mechanical and layout rules:**

- CoG outside the support polygon, or too far from the drive axle (traction)
- Sensor height outside the sensor's optimal range (from the DB sim model)
- Sensor lookahead too short or too long for the track's minimum radius at target speed
- Sensor array width vs line width (too narrow → can't recover. Spacing vs line width → blind gaps)
- Wheel-sensor alignment, overlapping parts, components hanging off the chassis edge, battery not secured
- Total mass vs motor torque → max acceleration estimate

### 5.5 Track system

- Built-in library (15+): oval, figure-8, S-curves, 90° turns, acute (<45°) turns, crossings, dashed and gap lines, inverted (white-on-black) sections, varying line width, a long straight for speed, a maze grid, and competition-style presets.
- **Track editor:** spline/arc/line segments, line width, colors, features. Validation: min radius and self-intersection allowed only at crossings.
- **Image upload pipeline** (`apps/vision`): perspective correction (4-point user handles) → adaptive threshold → morphology → skeletonize → graph extraction (junction detection) → polyline smoothing → user scale calibration ("this line is 19 mm wide" or "these two points are 1 m apart"). The editor opens with the result so the user can correct it.
- The sim also uses a rasterized **reflectance map** (1 px = 0.5 mm) for sensor sampling.

### 5.6 Simulation core (`packages/sim-core`)

- **Fixed-step integrator at 1 kHz** (semi-implicit Euler, RK4 optional), with a seeded PRNG (`xoshiro128**`). Same inputs give a bit-identical trace (golden tests).
- **DC motor model:** `V = I·R + Ke·ω`, `τ = Kt·I − b·ω − τ_friction`, gear ratio and efficiency, driver voltage drop (L298N ≈ 1.4–2 V vs MOSFET drivers ≈ 0.1–0.5 V), PWM → average voltage (with optional ripple), stall current limit.
- **Battery:** open-circuit voltage vs SoC curve, internal resistance → sag under load → brownout detection against MCU minimum voltage.
- **Drive dynamics:** differential drive with mass, yaw inertia (from placements), tire longitudinal and lateral friction (simplified slip model with μ per surface), caster drag, optional downforce (fan) increasing normal load.
- **IR sensor model:** each sensor samples the reflectance map over a circular footprint whose radius depends on height (cone angle from the DB). Response curve maps reflectance to ADC counts, plus ambient light offset, Gaussian noise, ADC quantization (10/12 bit), and sample latency. RC-type sensors (QTR-RC) are modeled as decay time.
- **Encoders, IMU:** derived from true state, plus noise and quantization.
- **Firmware coupling:** every physics tick, run the MCU for `cpuHz/1000` cycles. Pin writes (PWM duty from timer registers) are read into the motor model, and sensor values are written into the ADC or GPIO peripherals.
- **Failure detectors** (each a pure, unit-tested function over the trace):
  - `line_lost`: all sensors read background for > X ms
  - `off_track`: robot center > threshold distance from the track path
  - `oscillation`: FFT / zero-crossing rate of lateral error above threshold, with dominant frequency reported (P too high / D too low)
  - `stuck` / `infinite_loop`: track progress not increasing for > T while motors are active (spinning in place / circling), **or** PC stuck in a tight loop with no I/O
  - `missed_turn`: a turn feature passed without following it
  - `pwm_saturation`, `integrator_windup` (if variables are observable via debug symbols), `brownout`, `wdt_reset`, `blocking_delay` (long `delay()` inside the control loop, measured loop period)
  - `control_loop_jitter`: loop period histogram too wide
- **Metrics:** completion %, lap time, mean and max lateral error, loop frequency, energy used, oscillation index, a smoothness score, and a **robustness score** (passes / N seeds).
- **Monte Carlo:** randomize friction ±20%, sensor noise, ambient light, battery SoC, motor constant mismatch L/R ±5%, start pose jitter.

### 5.7 Firmware runtime (`packages/firmware-runtime`, `apps/compiler`)

- **Tier 1 (cycle-accurate emulation):** ATmega328P/2560/32U4 via `avr8js`. RP2040 via `rp2040js`. The compiler service builds with `arduino-cli` and returns `.hex` and `.elf`.
  - **PC → source line:** parse the ELF DWARF line table (`avr-objdump --dwarf=decodedline` at build time, shipped as JSON) so events and the "hot loop" profiler point to source lines.
  - **Variable watch:** read globals from SRAM using symbol addresses (`nm`), e.g. `error`, `integral`, `Kp`, plotted live.
- **Tier 2 (HAL shim):** ESP32 / STM32 / Teensy sketches compiled with emscripten against `packages/lfr-hal` (a mock `Arduino.h`, `analogRead`, `analogWrite`, `ledcWrite`, `millis`, `micros`, `delay` advancing sim time, `Serial`, common libs like `QTRSensors`). Line mapping comes from source maps and `__LINE__` tracing macros. Behavior is approximate (no real timers or interrupts), and the UI labels it as such.
- **Tier 3 (later):** Espressif's QEMU fork for ESP32 cycle-level emulation, MicroPython via its WASM port.
- **Security:** the compiler runs in a container with no network, a CPU/memory/time limit, read-only base, a non-root user, a fresh temp dir per job, and an allow-listed library set. Emulation runs client-side in the worker.
- **Static analysis:** clang-tidy + cppcheck, plus custom LFR rules (e.g. `delay()` > 5 ms inside `loop()`, integer division in PID, missing integral clamp, unsigned subtraction on `millis()`, `analogWrite` values > 255, pin constants that don't match the netlist, uninitialized PID state, `float` comparison with `==`).

### 5.8 AI debug agent (`packages/agent`, orchestrated by `apps/api`)

- **Model:** Claude via the official Anthropic TypeScript SDK (`@anthropic-ai/sdk`), model `claude-opus-5-5`, adaptive thinking, streaming, `effort: "high"` for diagnosis. Model ID and effort live in config, not hard-coded across the codebase.
- **Tool-use loop** (the SDK's Tool Runner or a manual loop the server hosts). Tools:
  - `get_firmware(fileId)`, `get_design_summary()`, `get_netlist()`
  - `get_run_report(runId)`: events with source lines, metrics, plots summarized as numbers
  - `get_trace_window(runId, tStart, tEnd, signals[])`
  - `static_analysis(code)`
  - `compile(code)` → errors / ok
  - `simulate(code, trackId, seeds[])` → metrics + events
  - `search_fix_knowledge(query)` (pgvector retrieval over verified past cases)
  - `propose_patch(unifiedDiff, rationale, expectedEffect)`
- **Verification gate (enforced in code, not left to the prompt):** a patch is shown to the user only if it applies cleanly, compiles, achieves `robustness ≥ previous` and `completion ≥ previous`, and introduces no new error-level events across the **same seeds plus fresh seeds**. At most K iterations (default 5) per request, then it reports honestly what it could not fix.
- **Output to the user:** a plain-language diagnosis ("At t=4.2 s, on the 90° left turn, all 8 sensors lose the line because base speed 200 with Kd=0 overshoots. See `loop()` line 57"), a diff view, the **full corrected file**, and before/after metrics plus ghost replay.
- **Human-in-the-loop:** "Test on your real track" → structured feedback form (worked / failed, where it failed on the track map, symptoms checklist, optional video and telemetry log). A failure starts another iteration with the real-world evidence attached.
- Safety and cost: per-user rate limits, a token budget per session, prompt caching on the stable system prompt and tool definitions, and refusal / `stop_reason` handling. User code is treated as data, never as instructions to the agent (prompt-injection hardening).

### 5.9 Learning loop ("train and learn", done honestly)

1. **Digital-twin calibration (per robot):** when telemetry or real-run outcomes arrive, fit twin parameters (friction μ, motor Kt/Ke per side, driver drop, sensor gain/offset/noise, latency) by minimizing the difference between simulated and real traces (CMA-ES or Bayesian optimization in a worker). Future simulations of _that_ robot get more accurate.
2. **Fix knowledge base (global):** every _user-confirmed_ fix stores `{symptom embedding, code-pattern, diff, design features, outcome}`. Embeddings come from an open-source model (e.g. `bge-small` via `sentence-transformers` in `apps/vision` or a small embedding service) and are stored in pgvector. The agent retrieves similar confirmed cases. Ranking is weighted by confirmation count.
3. **Learned models (phase 8+):** with enough data, train (a) a failure classifier from design and code features plus trace features → likely failure type, and (b) an RL or Bayesian auto-tuner for controller gains on the calibrated twin. Models are versioned with MLflow (or plain artifacts) and only shipped if they beat the baseline on a held-out set.
4. **Privacy:** opt-in sharing. Private designs never enter the global KB. Code stored in the KB is anonymized.

### 5.10 Photo → virtual design (`apps/vision`)

Realistic pipeline (assistive, not magic):

1. Upload 4–8 photos (top, bottom, front, back, sides). Guided capture overlay on mobile.
2. **Component detection:** YOLO model (trained on a dataset you collect and label: Arduino boards, drivers, sensors, motors, batteries). Until that exists, bootstrap with Claude vision for identification ("this is a TB6612FNG breakout") returning structured JSON with confidence.
3. **Match to the DB** (top-3 candidates per detection, the user picks one).
4. **Placement estimate:** use the top view with a known reference (wheel diameter or the board's known size) to get scale, then project detections onto the chassis plane.
5. **Chassis outline:** segment the top view → polygon → custom chassis.
6. **Wiring is NOT inferred automatically** (not reliable from photos). The app pre-fills a typical netlist for the detected combo, and the user confirms each net.
7. Optional (later): multi-view reconstruction (COLMAP / Gaussian splatting) as a visual-only backdrop.

### 5.11 Backend API (`apps/api`)

- Fastify + Zod + Drizzle + Postgres. Auth via Auth.js (GitHub + email magic link). Guest mode works fully local (IndexedDB) without an account.
- Resources: `/components`, `/chassis`, `/designs` (versions), `/tracks`, `/firmware`, `/compile`, `/runs` (server batch), `/agent/sessions` (SSE stream), `/feedback`, `/telemetry-logs`, `/gallery`.
- OpenAPI spec generated from Zod. Typed client in `packages/schema`.
- Observability: pino logs, OpenTelemetry traces, Sentry (optional).

---

## 6. UX flow

1. **Home** → "New robot" (template / blank / from photos / fork from gallery)
2. **Build** tab: 3D assembly, component search panel (left), findings panel (right, live)
3. **Wire** tab: schematic + 3D wires, pin tooltips, auto-route suggestions
4. **Code** tab: Monaco editor, board selector, compile, static-analysis squiggles
5. **Track** tab: library / editor / upload image
6. **Run** tab: 3D run, playback controls (0.1×–4×), plots, events timeline (click an event → jump to the time and the code line)
7. **Debug** tab: agent chat + diagnosis cards + diff + before/after
8. **Real test** modal → feedback → loop
9. **Connect robot**: Web Serial telemetry + flash

Design: dark/light themes, keyboard-first, responsive (assembly on desktop, run viewer and feedback on mobile), WCAG AA, i18n-ready (next-intl).

---

## 7. Quality bar and testing

| Layer                | Tooling                                                        | Must cover                                                                                                                                                      |
| -------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                 | Vitest (TS), pytest (Python)                                   | every rule, every detector, motor/battery/sensor model equations, track geometry, schema validation                                                             |
| Golden / determinism | Vitest snapshot of trace hashes                                | same seed → same trace; known buggy firmware → known failure events                                                                                             |
| Physics sanity       | property tests (fast-check)                                    | energy can't appear from nothing, symmetric inputs → straight line, higher μ → less slip                                                                        |
| Firmware fixtures    | `examples/firmware/*.ino` with expected outcomes               | `pid_no_derivative.ino` oscillates, `blocking_delay.ino` misses turns, `wrong_pins.ino` triggers a wiring-mismatch finding, `good_pid.ino` completes all tracks |
| Agent eval           | offline eval set of 30+ buggy sketches with ground-truth fixes | pass rate of the verification gate, tokens per fix                                                                                                              |
| E2E                  | Playwright                                                     | build → wire → code → run → see failure → agent fix → re-run passes                                                                                             |
| Perf                 | Playwright traces + bench scripts                              | 60 fps assembly, sim ≥ 20× real time headless on CI                                                                                                             |
| CI                   | GitHub Actions                                                 | lint (eslint, ruff), typecheck, unit, DB validation, build, e2e on PR; Docker images on release                                                                 |

No code ships "error free", and no one can promise that. What these gates do is catch regressions before users see them.

---

## 8. Limitations (state these in the README)

1. **Sim-to-real gap.** Friction, battery behavior, sensor response, and cheap motors that differ left from right are approximated. Calibration narrows the gap but never closes it. Passing in simulation means "likely to work", not "will work".
2. **Code coverage.** Cycle-accurate emulation covers AVR and RP2040 first. ESP32/STM32 run through an approximate HAL. Interrupt-heavy code, DMA, custom timer setups, RTOS tasks, and unusual libraries may not behave faithfully.
3. **Photo reconstruction is assistive.** Detection needs a labeled dataset, wiring can't be reliably read from photos, and scale and placement need user correction.
4. **LLM limitations.** Fixes can be wrong, and output is not deterministic. The verification gate reduces this but can't prove correctness on real hardware. API calls cost money (rate limits, BYO-key option for self-hosters).
5. **"Repeat until perfect" needs a stopping rule.** Iterations are capped. Some failures are hardware (dead sensor, loose wire, weak battery) that no code change can fix. The agent should say so.
6. **3D models and champion designs.** Real product meshes are often copyrighted. Templates are "inspired by" archetypes, not copies of specific teams' robots.
7. **Compute cost.** Compilation and batch Monte Carlo cost server time. Keep simulation client-side wherever possible.
8. **Browser limits.** Web Serial and Web Bluetooth work in Chromium browsers only. Low-end devices get reduced 3D quality.
9. **Learning needs data.** The knowledge base and learned models are weak until there are many confirmed cases. Plan a seeding strategy (synthetic bug injection: mutate good firmware, simulate, and record failure→fix pairs).

---

## 9. Licensing and community

- Code: **Apache-2.0** (or MIT). Component DB and tracks: **CC-BY-SA-4.0**. Third-party models keep their own licenses, recorded per entry.
- `CONTRIBUTING.md`, a component contribution template, issue templates (bug, component request, track request), and a code of conduct.
- README: hero GIF (robot failing → agent fix → robot passing), a live demo link, architecture diagram, "run locally in one command", roadmap, and the limitations section.

---

## 10. Roadmap summary (details in `docs/BUILD_PLAN.md`)

| Phase | Deliverable                                                            |
| ----- | ---------------------------------------------------------------------- |
| 0     | Monorepo, CI, schemas, docs skeleton                                   |
| 1     | Component DB (120+ entries) + search + procedural 3D models            |
| 2     | 3D assembly + chassis templates + custom chassis                       |
| 3     | Wiring/netlist + rules engine                                          |
| 4     | Tracks (library, editor, image import)                                 |
| 5     | Simulation core + run viewer (with a built-in JS reference controller) |
| 6     | Firmware runtime (compiler service, avr8js, PC→line, HAL shim)         |
| 7     | Failure detectors + static analysis + run report                       |
| 8     | AI debug agent + verification gate + feedback loop                     |
| 9     | Telemetry bridge, flashing, calibration, auto-tuner                    |
| 10    | Photo → design                                                         |
| 11    | Knowledge base, learned models, gallery/forking, polish, launch        |
