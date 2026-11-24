// Builds the five fixture robots used by the photo → design tests (fixtures/<id>/design.json and
// truth.json): real database parts, placed with LineLab's defaults, auto-wired, and checked by the
// rules engine (no errors). Their top-view "photos" are LineLab renders (scripts in e2e), labelled
// kind "render": they test the pipeline, not detection on real photos.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getChassis, getComponent } from "@linelab/component-db";
import { autoWire, defaultPlacement, newDesign } from "@linelab/design-core";
import { runRules } from "@linelab/rules-engine";
import type { DetectionResult, Design, PhotoSetTruth } from "@linelab/schema";
import { DESCRIBE } from "./describe.js";

const ROBOTS: { id: string; chassis: string; parts: [string, number][] }[] = [
  {
    id: "nano-tb6612-qtr8a",
    chassis: "chassis.pcb-racer",
    parts: [
      ["wheel.pololu-32x7", 2],
      ["motor.pololu-hp-6v-30-1", 2],
      ["caster.nylon-skid", 1],
      ["sensor.pololu-qtr-8a", 1],
      ["battery.lipo-2s-300mah", 1],
      ["driver.tb6612fng", 1],
      ["mcu.arduino-nano", 1],
      ["regulator.pololu-d24v10f5", 1],
    ],
  },
  {
    id: "uno-l9110s-tt",
    chassis: "chassis.starter-2wd",
    parts: [
      ["wheel.tt-65mm", 2],
      ["motor.tt-1-48", 2],
      ["caster.pololu-ball-3-4-metal", 1],
      ["sensor.tcrt5000-5ch", 1],
      ["driver.l9110s-module", 1],
      ["mcu.arduino-uno-r3", 1],
      ["battery.aa-4x-alkaline", 1],
    ],
  },
  {
    id: "esp32-drv8833-qtr8rc",
    chassis: "chassis.downforce-racer",
    parts: [
      ["wheel.n20-34mm", 2],
      ["motor.n20-6v-500rpm", 2],
      ["caster.nylon-skid", 1],
      ["sensor.pololu-qtr-8rc", 1],
      ["battery.lipo-2s-450mah", 1],
      ["driver.drv8833-pololu", 1],
      ["mcu.esp32-devkitc", 1],
      ["regulator.pololu-d24v10f5", 1],
    ],
  },
  {
    id: "pico-drv8835-qtrmd",
    chassis: "chassis.starter-2wd",
    parts: [
      ["wheel.tt-65mm", 2],
      ["motor.tt-1-120", 2],
      ["caster.pololu-ball-3-4-metal", 1],
      ["sensor.pololu-qtr-md-08a", 1],
      ["battery.lipo-2s-450mah", 1],
      ["driver.drv8835-pololu", 1],
      ["mcu.raspberry-pi-pico", 1],
      ["regulator.pololu-d24v10f5", 1],
    ],
  },
  {
    id: "promini-mx1508-tcrt8",
    chassis: "chassis.pcb-racer",
    parts: [
      ["wheel.n20-34mm", 2],
      ["motor.n20-6v-300rpm", 2],
      ["caster.nylon-skid", 1],
      ["sensor.tcrt5000-8ch-analog", 1],
      ["battery.lipo-2s-300mah", 1],
      ["driver.mx1508-module", 1],
      ["mcu.arduino-pro-mini-5v", 1],
      ["regulator.pololu-d24v10f5", 1],
    ],
  },
];

const root = join(import.meta.dirname, "..", "fixtures");
let bad = 0;
for (const r of ROBOTS) {
  const chassis = getChassis(r.chassis);
  if (!chassis) throw new Error(r.chassis);
  let d: Design = newDesign(`fixture-${r.id}`, r.id, { kind: "template", chassisId: r.chassis });
  for (const [id, n] of r.parts) {
    const c = getComponent(id);
    if (!c) throw new Error(id);
    for (let k = 0; k < n; k++)
      d = { ...d, placements: [...d.placements, defaultPlacement(c, d, chassis, getComponent)] };
  }
  d = { ...d, netlist: autoWire(d, getComponent) };
  const errors = runRules(d, chassis, getComponent).filter((f) => f.severity === "error");
  if (errors.length) {
    bad++;
    console.error(`✗ ${r.id}: ${errors.map((e) => `${e.id}: ${e.message}`).join("\n  ")}`);
  } else console.log(`✓ ${r.id}: ${d.placements.length} parts, ${d.netlist.length} nets`);
  const truth: PhotoSetTruth = {
    id: r.id,
    kind: "render",
    photos: [{ file: "top.png", view: "top" }],
    components: r.parts.map(([componentId, count]) => ({ componentId, count })),
  };
  mkdirSync(join(root, r.id), { recursive: true });
  writeFileSync(join(root, r.id, "design.json"), `${JSON.stringify(d, null, 2)}\n`);
  writeFileSync(join(root, r.id, "truth.json"), `${JSON.stringify(truth, null, 2)}\n`);
  // Scripted detector output (no boxes: tests add them from the synthetic top view).
  const detections: DetectionResult = {
    detector: "scripted",
    frontInTop: "up",
    notes: ["Scripted: hand-written descriptions of the parts, not a model's output."],
    detections: r.parts.map(([componentId, count], i) => {
      const c = getComponent(componentId);
      const say = DESCRIBE[componentId];
      if (!c || !say) throw new Error(`no description for ${componentId}`);
      return { id: `d${i + 1}`, category: c.category, ...say, count, confidence: 0.8 };
    }),
  };
  writeFileSync(
    join(root, r.id, "detections.scripted.json"),
    `${JSON.stringify(detections, null, 2)}\n`,
  );
}
process.exitCode = bad ? 1 : 0;
