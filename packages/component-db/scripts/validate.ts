// `pnpm db:validate`: validate component, chassis and track JSON against @linelab/schema.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Chassis, Component, Track } from "@linelab/schema";
import { validateTargets } from "../src/validate.js";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(pkgDir, "..", "..");

const report = validateTargets(
  [
    { label: "components", dir: join(pkgDir, "data", "components"), schema: Component },
    { label: "chassis", dir: join(pkgDir, "data", "chassis"), schema: Chassis },
    { label: "tracks", dir: join(repoRoot, "tracks"), schema: Track },
  ],
  repoRoot,
);

for (const p of report.problems) console.error(`✗ ${p.file}: ${p.message}`);
console.log(
  `db:validate — checked ${report.checked} file(s), ${report.problems.length} problem(s).`,
);
process.exitCode = report.problems.length > 0 ? 1 : 0;
