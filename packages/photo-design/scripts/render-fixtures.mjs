// Draws fixtures/<id>/top.png: LineLab's own top-view render of each fixture robot (from
// syntheticTopView), labelled "LineLab render (not a photo)". Used by the photo wizard's e2e
// test and the vision outline check. Needs Playwright's Chromium. Run after `pnpm build`.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { getChassis, getComponent } from "@linelab/component-db";
import { resolveChassis } from "@linelab/design-core";
import { syntheticTopView } from "../dist/index.js";

const { chromium } = createRequire(import.meta.url)("playwright");
const root = join(import.meta.dirname, "..", "fixtures");
const ids = [
  "nano-tb6612-qtr8a",
  "uno-l9110s-tt",
  "esp32-drv8833-qtr8rc",
  "pico-drv8835-qtrmd",
  "promini-mx1508-tcrt8",
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const id of ids) {
  const design = JSON.parse(readFileSync(join(root, id, "design.json"), "utf8"));
  const chassis = resolveChassis(design, getChassis);
  const view = syntheticTopView(design, chassis, getComponent, 0.5);
  await page.setViewportSize({ width: view.widthPx, height: view.heightPx });
  await page.setContent(`<html><body style="margin:0">${view.svg}</body></html>`);
  writeFileSync(join(root, id, "top.png"), await page.screenshot());
  writeFileSync(
    join(root, id, "top.view.json"),
    `${JSON.stringify({ widthPx: view.widthPx, heightPx: view.heightPx, mmPerPx: view.mmPerPx, outline: view.outline, boxes: Object.fromEntries(view.boxes) }, null, 1)}\n`,
  );
  console.log(id, view.widthPx, view.heightPx);
}
await browser.close();
