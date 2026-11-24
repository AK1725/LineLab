// `pnpm eval:photos`: the BUILD_PLAN Phase 10 detection metric. For every photo set in
// fixtures/ (and any extra directories given as arguments), run the live detector (Claude vision;
// needs ANTHROPIC_API_KEY, costs money), match each detection to the database, and count how many
// of the set's major components appear in some detection's top 3. Exits non-zero below 80 %.
//
// The committed sets are LineLab renders (kind "render"): flat drawings with no markings, so
// they say little about real photos. Add real photo sets (photos + truth.json, kind "real") to
// measure what matters; the report separates the two kinds.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { extname, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { COMPONENTS, createSearchIndex } from "@linelab/component-db";
import { PhotoSetTruth } from "@linelab/schema";
import { ClaudeVisionDetector, visionConfigFromEnv } from "../src/claude.js";
import type { PhotoInput } from "../src/detector.js";
import { matchDetections } from "../src/match.js";

const fixtures = join(import.meta.dirname, "..", "fixtures");
const dirs = [
  ...readdirSync(fixtures, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(fixtures, d.name)),
  ...process.argv.slice(2),
].filter((d) => existsSync(join(d, "truth.json")));

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY to run the photo eval (it calls the vision model).");
  process.exit(2);
}
const detector = new ClaudeVisionDetector(new Anthropic(), visionConfigFromEnv());
const index = createSearchIndex(COMPONENTS);
const MEDIA: Record<string, PhotoInput["mediaType"]> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const tally: Record<string, { hit: number; total: number }> = {};
for (const dir of dirs) {
  const truth = PhotoSetTruth.parse(JSON.parse(readFileSync(join(dir, "truth.json"), "utf8")));
  const photos: PhotoInput[] = truth.photos.map((p) => ({
    view: p.view,
    mediaType: MEDIA[extname(p.file).toLowerCase()] ?? "image/jpeg",
    data: readFileSync(join(dir, p.file)).toString("base64"),
  }));
  const r = await detector.detect(photos);
  const matches = matchDetections(r.detections, index, COMPONENTS);
  const top3 = new Set(matches.flatMap((m) => m.candidates.map((c) => c.componentId)));
  const t = (tally[truth.kind] ??= { hit: 0, total: 0 });
  for (const c of truth.components) {
    t.total++;
    const ok = top3.has(c.componentId);
    if (ok) t.hit++;
    console.log(`${ok ? "✓" : "✗"} ${truth.id} (${truth.kind}): ${c.componentId}`);
  }
}
let pass = true;
for (const [kind, t] of Object.entries(tally)) {
  const rate = t.hit / Math.max(1, t.total);
  console.log(
    `${kind}: ${t.hit}/${t.total} major components in the top 3 (${Math.round(rate * 100)} %)`,
  );
  if (rate < 0.8) pass = false;
}
if (!tally.real) console.log("No real photo sets: the acceptance metric needs real photos.");
process.exitCode = pass ? 0 : 1;
