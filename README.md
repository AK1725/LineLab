# LineLab

**Design, wire, simulate and debug line-following robots in the browser.**

You put together a virtual twin of your real robot from a database of real components, run **your actual firmware** on an emulated microcontroller on a virtual track, and see exactly where and why it fails. An AI debugging agent then proposes a fix that is verified in simulation before you ever see it.

![LineLab: a robot assembled in 3D, then simulated on a track with live plots and a run report](docs/hero.gif)

> **Status: all 12 build phases (0–11) are done.** Search 124 real components, assemble a robot in 3D on a chassis template or your own outline, wire it (or auto-wire it) with 50 live electrical and mechanical checks, then simulate it on 18 tracks (or your own, or one imported from a photo).
>
> The robot runs a reference PID or **your own Arduino sketch**, emulated cycle-accurately on AVR boards. Every run comes with a report: failures tied to the line of your sketch that caused them, line-follower lint, cppcheck and clang-tidy.
>
> - **AI debugger** (Claude): finds the cause and proposes a fix, shown only after LineLab has compiled it and verified it in simulation.
> - **Robot tab**: talks to your real robot over USB or Bluetooth, flashes Uno, Nano and Pro Mini boards, calibrates the simulator to your recordings, and auto-tunes PID gains.
> - **Photo import**: start a design from photos of your robot.
> - **Sharing and learning**: publish and fork robots in the gallery, follow guided lessons, and use the studio offline.
>
> What is not verified yet is listed honestly in [`docs/PROGRESS.md`](docs/PROGRESS.md).

---

## Run it with Docker (any machine with Docker)

You need **Docker** with Compose v2.24 or later, about 8 GB of free disk, and git.

```bash
git clone https://github.com/AK1725/LineLab.git
```

```bash
cd LineLab
```

```bash
docker compose --profile apps up -d --build
```

Open **http://localhost:3000**. The first build takes 15–30 minutes, mostly because the compiler image downloads the Arduino AVR and ESP32 toolchains. Later starts take seconds.

- **Everything except the AI features works without any account or key.** That includes designs, simulation, firmware compile and emulation, the Robot tab, the gallery and lessons. Designs are kept in your browser.
- **AI debugger and photo detection**: put `ANTHROPIC_API_KEY=…` in a `.env` file next to `docker-compose.yml` and run the command again. Users can also paste their own key in the app; it is used for that request only.
- **Gallery sign-in**: choose "Email me a sign-in link". To send real emails, set `SMTP_URL` (e.g. `smtps://user:pass@smtp.example.com:465`) and `MAIL_FROM` in `.env`. Without them, the link is printed in the API log (`docker compose logs api`). For GitHub sign-in, set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.
- **Stop**: `docker compose --profile apps down`. Data lives in Docker volumes; add `-v` to delete it.

To put a public demo online with HTTPS, see [`deploy/README.md`](deploy/README.md).

## How it fits together

```mermaid
flowchart LR
  subgraph Browser["Browser (works offline)"]
    UI["Next.js studio<br/>3D editor · Code · Run · Robot"]
    SIM["sim-core: 1 kHz physics<br/>+ firmware-runtime: avr8js / WASM HAL<br/>(Web Workers)"]
    IDB[("IndexedDB<br/>your designs")]
    UI --- SIM
    UI --- IDB
  end
  UI -- "/api" --> WEB["web server<br/>(proxy)"]
  WEB --> API["apps/api (Fastify)<br/>AI debugger · gallery · sign-in<br/>photo detection · knowledge base"]
  WEB --> COMP["apps/compiler<br/>arduino-cli · clang→wasm<br/>no network, 1 GB, 60 s"]
  WEB --> VIS["apps/vision (FastAPI)<br/>track images · robot outlines<br/>text embeddings (bge-small)"]
  API --> PG[("Postgres + pgvector")]
  API --> COMP
  API --> VIS
  API -. "optional" .-> CLAUDE["Claude API"]
  Robot["Your robot<br/>(LineLabTelemetry)"] <-- "Web Serial / Bluetooth" --> UI
```

The simulator, the emulated microcontroller and your designs all run in the browser. The servers compile firmware in a sandbox, run the AI and vision features, and host the shared gallery and knowledge base.

## Develop

Prerequisites: **Node 22**, **pnpm 10** (`corepack enable`), **[uv](https://docs.astral.sh/uv/)** (Python), **Docker**.

```bash
pnpm install
```

```bash
(cd apps/vision && uv sync)
```

```bash
docker compose up -d        # Postgres + pgvector, Redis, S3 storage (SeaweedFS)
```

```bash
pnpm dev                    # web :3000, api :4000, vision :8000
```

Copy `.env.example` to `.env` for local settings.

### Everyday commands

| Command                                         | What it does                                                                                             |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `pnpm verify`                                   | format check, lint, typecheck, unit tests (TS and Python), `db:validate`, build. CI runs exactly this.   |
| `pnpm test:e2e`                                 | Playwright end-to-end tests against a production build                                                   |
| `pnpm db:validate`                              | validate every component, chassis and track JSON file                                                    |
| `pnpm sim -- --track oval --seeds 1..50`        | headless simulation (reference PID) with Monte Carlo; `--design file.json`, `--trace out.json`, `--json` |
| `pnpm eval:photos`                              | photo-detection eval: major parts in the top 3 (needs `ANTHROPIC_API_KEY` and photo sets; costs money)   |
| `pnpm eval:agent`                               | AI debugger eval on the 12 buggy fixtures (needs `ANTHROPIC_API_KEY` and a compiler; costs money)        |
| `pnpm --filter @linelab/e2e lighthouse`         | Lighthouse on the home and run pages (needs a running build on :3100); fails below 90                    |
| `pnpm bench:sim`                                | simulator speed; fails below 20× real time                                                               |
| `pnpm --filter @linelab/schema schema:generate` | regenerate the JSON Schema files after a schema change                                                   |
| `docker compose --profile apps up -d --build`   | run the whole stack in containers                                                                        |

## Repository layout

```
apps/web            Next.js studio UI
apps/api            Fastify API
apps/vision         Python FastAPI: track images, robot photos
apps/compiler       sandboxed firmware compiler: arduino-cli (AVR) and clang→wasm32 (HAL)
packages/schema     Zod schemas + generated JSON Schema: the single source of truth for data
packages/component-db  open component & chassis database + validator
packages/design-core   editor logic: mass/CoG, collisions, snapping, undo/redo, auto-wiring, DXF/SVG/STL/KiCad
packages/rules-engine  35 electrical + 15 mechanical checks with explanations and fixes
packages/sim-core      tracks, 1 kHz physics (motors, battery, tyres, IR sensors), reference PID, Monte Carlo
packages/firmware-runtime  runs firmware in the simulator: avr8js (ATmega328P) and the WebAssembly HAL
packages/lfr-hal       simulated Arduino core (C++) for the HAL tier
packages/firmware-lint line-follower lint rules for sketches
packages/run-report    per-run report: detector events with source lines, lint, metrics
examples/firmware      example sketches (and 12 buggy fixtures) with prebuilt artifacts
packages/agent         AI debug agent: tool loop, workbench, verification gate
packages/telemetry-lib LineLabTelemetry Arduino library + TS codec for real-robot telemetry
packages/calibrate     twin calibration (CMA-ES) and PID auto-tuner (Bayesian optimisation)
packages/photo-design  photo → design: detector interface (Claude vision), DB top-3, layout, wiring proposal
examples/agent         scripted agent transcript (demos, e2e)
packages/three-models, ui
tracks/             18 built-in tracks (JSON, generated by sim-core/scripts/build-tracks.ts)
e2e/                Playwright tests (incl. axe), Lighthouse script
deploy/             public demo: Caddy (HTTPS) + compose override
docs/               blueprint, build plan, progress log, ADRs
```

## Roadmap

| Phase | Deliverable                                                             | Status |
| ----- | ----------------------------------------------------------------------- | ------ |
| 0     | Monorepo, CI, schemas, infrastructure                                   | ✅     |
| 1     | Component database (124 parts), search, procedural 3D models            | ✅     |
| 2     | 3D assembly editor, chassis templates, custom chassis                   | ✅     |
| 3     | Wiring/netlist editor and live rules engine                             | ✅     |
| 4     | Tracks: library, editor, image-to-track                                 | ✅     |
| 5     | Deterministic physics simulation and run viewer                         | ✅     |
| 6     | Run real firmware (AVR emulation, HAL shim; RP2040 emulation deferred)  | ✅     |
| 7     | Failure detection, static analysis, run report                          | ✅     |
| 8     | AI debug agent with a verification gate                                 | ✅     |
| 9     | Real-robot telemetry, browser flashing, twin calibration, PID auto-tune | ✅     |
| 10    | Photo to virtual design                                                 | ✅     |
| 11    | Knowledge base, gallery, polish, launch                                 | ✅     |

Full detail: [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md) (what and why), [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) (order and acceptance criteria), [`docs/PROGRESS.md`](docs/PROGRESS.md) (where we are), [`docs/adr/`](docs/adr) (decisions).

## Honest limitations

Simulation is not reality. Passing in LineLab means "likely to work", not "will work". Emulation is cycle-accurate only for AVR boards (Uno, Nano, Pro Mini); other boards run on an approximate HAL. Photo import assists rather than automates, and AI fixes can be wrong (which is why they are verified in simulation first). See [BLUEPRINT §8](docs/BLUEPRINT.md#8-limitations-state-these-in-the-readme).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Adding components to the database is the easiest way to help.

## License

- Code: [Apache-2.0](LICENSE)
- Component database and tracks: [CC-BY-SA-4.0](https://creativecommons.org/licenses/by-sa/4.0/)
