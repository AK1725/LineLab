import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildJsonSchemas, serialiseJsonSchema } from "../src/json-schema.js";

const jsonSchemaDir = join(dirname(fileURLToPath(import.meta.url)), "..", "json-schema");

describe("generated JSON Schema", () => {
  const schemas = buildJsonSchemas();

  it.each(Object.keys(schemas))("%s.schema.json is up to date", (kind) => {
    const committed = readFileSync(join(jsonSchemaDir, `${kind}.schema.json`), "utf8");
    const fresh = serialiseJsonSchema(schemas[kind as keyof typeof schemas]);
    // If this fails: pnpm --filter @linelab/schema schema:generate
    expect(committed).toBe(fresh);
  });

  it("targets draft 2020-12 and has stable ids", () => {
    for (const [kind, schema] of Object.entries(schemas)) {
      expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(schema.$id).toBe(`https://linelab.dev/schema/${kind}.schema.json`);
    }
  });
});
