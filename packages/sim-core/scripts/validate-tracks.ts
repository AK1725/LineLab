// Part of `pnpm db:validate`: geometric checks on every built-in track (schema checks run in
// @linelab/component-db).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Track } from "@linelab/schema";
import { validateTrackGeometry } from "../src/track/validate.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tracks");
let problems = 0;
let checked = 0;
for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
  const parsed = Track.safeParse(JSON.parse(readFileSync(join(dir, f), "utf8")));
  if (!parsed.success) continue; // reported by component-db's schema validation
  checked++;
  for (const p of validateTrackGeometry(parsed.data)) {
    problems++;
    console.error(`✗ tracks/${f}: ${p.message}`);
  }
}
console.log(`db:validate (tracks) — ${checked} track(s), ${problems} geometry problem(s).`);
process.exitCode = problems > 0 ? 1 : 0;
