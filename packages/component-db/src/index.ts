/**
 * Browser-safe entry point: the catalog, search and category metadata.
 * Node-only validation lives in `@linelab/component-db/validate`.
 */
import type { Component } from "@linelab/schema";
import { COMPONENTS } from "./generated/catalog.js";

export { COMPONENTS };
export { CATEGORY_INFO, categoryLabel, categoryOrder } from "./categories.js";
export {
  createSearchIndex,
  type SearchHit,
  type SearchIndex,
  type SearchOptions,
} from "./search.js";
export { compact, tokens } from "./text.js";

const byId = new Map(COMPONENTS.map((c) => [c.id, c]));

export function getComponent(id: string): Component | undefined {
  return byId.get(id);
}
