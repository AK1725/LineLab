import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHASSIS, getChassis, getComponent } from "@linelab/component-db";
import { resolveChassis } from "@linelab/design-core";
import { DetectionResult, Design, PhotoSetTruth } from "@linelab/schema";

export const FIXTURES = [
  "nano-tb6612-qtr8a",
  "uno-l9110s-tt",
  "esp32-drv8833-qtr8rc",
  "pico-drv8835-qtrmd",
  "promini-mx1508-tcrt8",
] as const;

const dir = join(import.meta.dirname, "..", "fixtures");
const json = (p: string): unknown => JSON.parse(readFileSync(join(dir, p), "utf8"));

export function fixture(id: string) {
  const design = Design.parse(json(`${id}/design.json`));
  const chassis = resolveChassis(design, getChassis);
  if (!chassis) throw new Error("chassis");
  return {
    design,
    chassis,
    truth: PhotoSetTruth.parse(json(`${id}/truth.json`)),
    detections: DetectionResult.parse(json(`${id}/detections.scripted.json`)),
  };
}

export { CHASSIS, getChassis, getComponent };
