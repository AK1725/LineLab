// Test helpers (not exported from the package): the reference robot built from the real
// component data, read from disk.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPONENTS, getChassis, getComponent } from "@linelab/component-db";
import { resolveChassis } from "@linelab/design-core";
import { Design, Track, type Component } from "@linelab/schema";
import { buildRobotModel } from "../model/robot.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const referenceDesign = () =>
  Design.parse(JSON.parse(readFileSync(join(root, "fixtures", "reference.design.json"), "utf8")));

export function robotFor(design: Design) {
  const chassis = resolveChassis(design, getChassis);
  if (!chassis) throw new Error("chassis");
  return buildRobotModel(design, chassis, getComponent);
}

export const referenceRobot = () => robotFor(referenceDesign());

export const builtInTrack = (id: string) =>
  Track.parse(
    JSON.parse(readFileSync(join(root, "..", "..", "tracks", `track.${id}.json`), "utf8")),
  );

export function specOf<K extends Component["electrical"]["kind"]>(id: string, kind: K) {
  const e = COMPONENTS.find((c) => c.id === id)?.electrical;
  if (e?.kind !== kind) throw new Error(`${id} has no ${kind} spec`);
  return e as Extract<Component["electrical"], { kind: K }>;
}
