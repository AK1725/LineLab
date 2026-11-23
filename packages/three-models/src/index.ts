import type { Component } from "@linelab/schema";
import type { Group } from "three";
import { GENERATORS, type Generator } from "./generators.js";

export { GENERATORS, type Generator } from "./generators.js";
export { COLORS, PALETTE_ORDER, paletteColor, type Dims } from "./kit.js";
export { buildChassisModel } from "./chassis.js";
export { mergeByMaterial } from "./merge.js";

type ModelSource = Pick<Component, "id" | "dimensionsMm" | "model">;

/** Problems with a component's model definition; [] when it can be built. */
export function checkComponentModel(c: ModelSource): string[] {
  if (c.model.kind === "gltf") {
    return ["glTF models are not supported yet (procedural models only until a later phase)."];
  }
  const gen: Generator | undefined = GENERATORS[c.model.generator];
  if (gen === undefined) {
    return [
      `unknown generator "${c.model.generator}" (known: ${Object.keys(GENERATORS).join(", ")})`,
    ];
  }
  return gen.check(c.model.params);
}

/**
 * Builds the three.js model for a component: millimetres, Z up, sitting on z = 0, centred in X/Y.
 * Materials are shared between models; dispose geometries only, never materials.
 */
export function buildComponentModel(c: ModelSource): Group {
  const problems = checkComponentModel(c);
  if (problems.length > 0) throw new Error(`${c.id}: ${problems.join("; ")}`);
  if (c.model.kind !== "procedural") throw new Error(`${c.id}: not a procedural model`);
  const gen = GENERATORS[c.model.generator];
  if (gen === undefined) throw new Error(`${c.id}: unknown generator`);
  const group = gen.build(c.dimensionsMm, c.model.params);
  group.userData.componentId = c.id;
  return group;
}
