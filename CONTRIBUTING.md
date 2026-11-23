# Contributing to LineLab

Thanks for helping. LineLab is built phase by phase, so check [`docs/PROGRESS.md`](docs/PROGRESS.md) first to see what's being worked on.

## Ground rules

1. **`pnpm verify` must pass** before you open a PR. It runs exactly what CI runs.
2. **Tests with every change.** Rules and failure detectors need a triggering and a non-triggering test.
3. **No fake functionality.** If something isn't built, the UI says "coming soon". Never hard-code demo results.
4. **Shared types live in `packages/schema`.** Change the Zod schema, then run `pnpm --filter @linelab/schema schema:generate`.
5. **Big decisions get an ADR** in `docs/adr/`.

## Adding a component (easiest first contribution)

1. Create `packages/component-db/data/components/<id>.json`, where `<id>` is a dotted id like `driver.tb6612fng`.
2. Add `"$schema": "../../../schema/json-schema/component.schema.json"` at the top for editor autocompletion.
3. Fill in pins, dimensions, mass and electrical specs **from the datasheet**, and list it in `sources`.
4. Run `pnpm db:validate`.

Component data is licensed CC-BY-SA-4.0. Only submit data you are allowed to share. Never paste copyrighted 3D models: use the procedural model generators instead.

## Development setup

See the README quick start. Python checks run through uv (`apps/vision`), and `pnpm verify` calls them for you.

## Commit and PR style

- Branches: `phase-N-<slug>` for phase work, `fix/<slug>` or `feat/<slug>` otherwise.
- Small, focused commits with imperative messages ("Add QTR-8A sensor model").
- Include screenshots or a GIF for UI changes.
