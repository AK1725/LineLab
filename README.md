# LineLab

**Design, wire, simulate and debug line-following robots in the browser.**

You put together a virtual twin of your real robot from a database of real components, run **your actual firmware** on an emulated microcontroller on a virtual track, and see exactly where and why it fails. An AI debugging agent then proposes a fix that is verified in simulation before you ever see it.

> **Status: Phase 0 of 11 — foundation.** The monorepo, schemas, CI and infrastructure are in place. The editor, simulator and debugger are not built yet. See the [roadmap](#roadmap).

---

## Quick start

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

| Command                                         | What it does                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pnpm verify`                                   | format check, lint, typecheck, unit tests (TS and Python), `db:validate`, build. CI runs exactly this. |
| `pnpm test:e2e`                                 | Playwright end-to-end tests against a production build                                                 |
| `pnpm db:validate`                              | validate every component, chassis and track JSON file                                                  |
| `pnpm --filter @linelab/schema schema:generate` | regenerate the JSON Schema files after a schema change                                                 |
| `docker compose --profile apps up -d --build`   | run the whole stack in containers                                                                      |

## Repository layout

```
apps/web            Next.js studio UI
apps/api            Fastify API
apps/vision         Python FastAPI: track images, robot photos
apps/compiler       sandboxed firmware compiler (Phase 6)
packages/schema     Zod schemas + generated JSON Schema: the single source of truth for data
packages/component-db  open component & chassis database + validator
packages/rules-engine, sim-core, firmware-runtime, agent, three-models, ui, lfr-hal, telemetry-lib
tracks/             built-in tracks (JSON)
e2e/                Playwright tests
docs/               blueprint, build plan, progress log, ADRs
```

## Roadmap

| Phase | Deliverable                                                             | Status |
| ----- | ----------------------------------------------------------------------- | ------ |
| 0     | Monorepo, CI, schemas, infrastructure                                   | ✅     |
| 1     | Component database (120+ parts), search, procedural 3D models           | ⏳     |
| 2     | 3D assembly editor, chassis templates, custom chassis                   |        |
| 3     | Wiring/netlist editor and live rules engine                             |        |
| 4     | Tracks: library, editor, image-to-track                                 |        |
| 5     | Deterministic physics simulation and run viewer                         |        |
| 6     | Run real firmware (AVR / RP2040 emulation, HAL shim)                    |        |
| 7     | Failure detection, static analysis, run report                          |        |
| 8     | AI debug agent with a verification gate                                 |        |
| 9     | Real-robot telemetry, browser flashing, twin calibration, PID auto-tune |        |
| 10    | Photo to virtual design                                                 |        |
| 11    | Knowledge base, gallery, polish, launch                                 |        |

Full detail: [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md) (what and why), [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) (order and acceptance criteria), [`docs/PROGRESS.md`](docs/PROGRESS.md) (where we are), [`docs/adr/`](docs/adr) (decisions).

## Honest limitations

Simulation is not reality. Passing in LineLab means "likely to work", not "will work". Emulation is cycle-accurate only for AVR and RP2040, photo import assists rather than automates, and AI fixes can be wrong (which is why they are verified in simulation first). See [BLUEPRINT §8](docs/BLUEPRINT.md#8-limitations-state-these-in-the-readme).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Adding components to the database is the easiest way to help.

## License

- Code: [Apache-2.0](LICENSE)
- Component database and tracks: [CC-BY-SA-4.0](https://creativecommons.org/licenses/by-sa/4.0/)
