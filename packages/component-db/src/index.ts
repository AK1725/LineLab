/**
 * Browser-safe entry point: the catalog, search and category metadata.
 * Node-only validation lives in `@linelab/component-db/validate`.
 */
import type { Chassis, Component, Track } from "@linelab/schema";
import { CHASSIS, COMPONENTS, TRACKS } from "./generated/catalog.js";

export { CHASSIS, COMPONENTS, TRACKS };
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

const chassisById = new Map(CHASSIS.map((c) => [c.id, c]));

export function getChassis(id: string): Chassis | undefined {
  return chassisById.get(id);
}

const trackById = new Map(TRACKS.map((t) => [t.id, t]));

export function getTrack(id: string): Track | undefined {
  return trackById.get(id);
}
