// Regenerates packages/schema/json-schema/*.schema.json from the Zod schemas.
// Run: pnpm --filter @linelab/schema schema:generate  (a test fails if these files drift).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildJsonSchemas, serialiseJsonSchema } from "../src/json-schema.js";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "json-schema");
mkdirSync(outDir, { recursive: true });

for (const [kind, schema] of Object.entries(buildJsonSchemas())) {
  const file = join(outDir, `${kind}.schema.json`);
  writeFileSync(file, serialiseJsonSchema(schema));
  console.log(`wrote ${file}`);
}
