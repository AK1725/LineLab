import { z } from "zod";
import { documentSchemas, type DocumentKind } from "./index.js";

/**
 * JSON Schema (draft 2020-12) for each top-level document.
 * Cross-field rules (unique pin ids, net references, ...) live in Zod refinements and are
 * NOT expressible here — always validate with the Zod schema as the source of truth.
 */
export function buildJsonSchemas(): Record<DocumentKind, Record<string, unknown>> {
  const out = {} as Record<DocumentKind, Record<string, unknown>>;
  for (const [kind, schema] of Object.entries(documentSchemas) as [DocumentKind, z.ZodType][]) {
    out[kind] = {
      ...z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" }),
      $id: `https://linelab.dev/schema/${kind}.schema.json`,
      title: `LineLab ${kind}`,
    };
  }
  return out;
}

export function serialiseJsonSchema(schema: Record<string, unknown>): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}
