# @linelab/component-db

The open LineLab component database: **124 parts** for line-following robots, plus search and validation.

| Category         | Count | Category                                               | Count |
| ---------------- | ----- | ------------------------------------------------------ | ----- |
| Microcontrollers | 18    | Regulators                                             | 9     |
| Motors           | 17    | Other sensors                                          | 9     |
| Line sensors     | 12    | Wheels                                                 | 7     |
| Batteries        | 12    | Casters, mechanical                                    | 5 + 5 |
| Motor drivers    | 11    | Wireless, inputs, indicators, display, fans, ESC, misc | 19    |

- `data/components/<id>.json`: one file per component, validated against `Component` in [`@linelab/schema`](../schema).
- `data/chassis/<id>.json`: chassis templates (Phase 2).
- Data is licensed **CC-BY-SA-4.0**. Every entry cites at least one source.

## Using it

```ts
import { COMPONENTS, getComponent, createSearchIndex } from "@linelab/component-db"; // browser-safe

const search = createSearchIndex(COMPONENTS);
search.search("tb6612"); // exact model numbers first
search.search("n20 1000"); // every word must match
search.search("pololu", { categories: ["line_sensor"] }); // category filter
search.search("tb6621"); // typo → fuzzy fallback
```

`@linelab/component-db/validate` (Node only) exposes the file validator and `checkCatalog`.

## Validation (`pnpm db:validate`)

Beyond the JSON Schema, every component must pass:

- **3D model**: the generator exists, its params are valid, and the generated model fits inside `dimensionsMm`.
- **Pins**: `arduinoPin` names are unique. MCU I/O voltages match the logic voltage. Pins with ADC data have the `analog` function. Input-only pins have no output functions.
- **Line sensors**: the number of output pins equals `channels`.
- **Motor drivers**: 2 motor outputs per channel.
- **Wheels**: `dimensionsMm` = diameter × width × diameter.
- **Search**: no alias or name is shared by two components.

## Data quality: `specStatus`

Every entry currently has `"specStatus": "needs-review"`, and the UI shows a warning on its page. The values were written from manufacturer documentation and common module listings, but **no one has yet checked each value against the cited datasheet**. To review a part:

1. Open each URL in `sources` and compare dimensions, pins and electrical values.
2. Fix what is wrong, then set `"specStatus": "reviewed"` and mention the datasheet revision in your PR.

Generic modules (L298N boards, TCRT5000 arrays, N20 motors) vary by seller. Their `notes` say so, and their sources point to the chip datasheet or a distributor search.
