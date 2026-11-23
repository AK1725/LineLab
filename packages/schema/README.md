# @linelab/schema

The single source of truth for LineLab's data shapes. Zod schemas first, TypeScript types inferred from them.

| Document             | Zod export  | JSON Schema                         |
| -------------------- | ----------- | ----------------------------------- |
| Component (DB entry) | `Component` | `json-schema/component.schema.json` |
| Chassis template     | `Chassis`   | `json-schema/chassis.schema.json`   |
| Robot design         | `Design`    | `json-schema/design.schema.json`    |
| Track                | `Track`     | `json-schema/track.schema.json`     |
| Simulation run trace | `RunTrace`  | `json-schema/run-trace.schema.json` |
| Rules-engine finding | `Finding`   | `json-schema/finding.schema.json`   |

Units: geometry in **mm**, angles in **radians**, time in **ms**, other quantities SI unless the field name says otherwise (`massG`, `capacitymAh`, `stallTorqueKgCm`).

The JSON Schema files exist for editor autocompletion (`"$schema": "../../packages/schema/json-schema/component.schema.json"`). They cannot express cross-field rules (duplicate pin ids, nets that reference missing parts), so always validate with the Zod schema.

After changing a schema, run:

```bash
pnpm --filter @linelab/schema schema:generate
```

A unit test fails if the committed JSON Schema files are out of date.
