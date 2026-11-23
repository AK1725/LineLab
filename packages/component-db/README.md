# @linelab/component-db

The open LineLab component and chassis database.

- `data/components/<id>.json`: one file per component, validated against `Component` in [`@linelab/schema`](../schema).
- `data/chassis/<id>.json`: chassis templates, validated against `Chassis`.
- Licensed **CC-BY-SA-4.0**. Every entry must cite at least one source (datasheet or product page).

Validate everything (components, chassis, and the repo's `tracks/`):

```bash
pnpm db:validate
```

Status: the validator is in place (Phase 0). The 120+ components arrive in **Phase 1**.
