// Shared by the sim CLI and the benchmark: load designs and tracks, build robot models.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getChassis, getComponent } from "@linelab/component-db";
import { resolveChassis } from "@linelab/design-core";
import { Design, Track } from "@linelab/schema";
import { buildRobotModel, type RobotModel } from "../src/model/robot.js";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const readJson = (f: string): unknown => JSON.parse(readFileSync(f, "utf8"));

/** A track file, or a built-in track id ("oval" or "track.oval"). */
export function loadTrack(pathOrId: string): Track {
  const file = pathOrId.endsWith(".json")
    ? pathOrId
    : join(
        repoRoot,
        "tracks",
        `${pathOrId.startsWith("track.") ? pathOrId : `track.${pathOrId}`}.json`,
      );
  return Track.parse(readJson(file));
}

export function loadRobot(designPath: string): { design: Design; robot: RobotModel } {
  const design = Design.parse(readJson(designPath));
  const chassis = resolveChassis(design, getChassis);
  if (!chassis) throw new Error(`Unknown chassis in ${designPath}`);
  return { design, robot: buildRobotModel(design, chassis, getComponent) };
}

export const allTrackIds = () =>
  readdirSync(join(repoRoot, "tracks"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
