// Test helpers: the reference robot and tracks from disk.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getChassis, getComponent } from "@linelab/component-db";
import { resolveChassis } from "@linelab/design-core";
import { Design, TelemetryRecording, Track } from "@linelab/schema";
import { buildRobotModel } from "@linelab/sim-core";

export const repo = join(import.meta.dirname, "..", "..", "..");
const json = (p: string): unknown => JSON.parse(readFileSync(join(repo, p), "utf8"));

export const referenceDesign = () =>
  Design.parse(json("packages/sim-core/fixtures/reference.design.json"));
export const track = (id: string) => Track.parse(json(`tracks/track.${id}.json`));
export function buildRobot(design: Design) {
  const c = resolveChassis(design, getChassis);
  if (!c) throw new Error("chassis");
  return buildRobotModel(design, c, getComponent);
}
export const hiddenTwinFixture = () => ({
  recording: TelemetryRecording.parse(
    json("packages/calibrate/fixtures/hidden-twin.recording.json"),
  ),
  truth: json("packages/calibrate/fixtures/hidden-twin.truth.json") as Record<string, number>,
});
