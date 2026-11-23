// `pnpm db:validate`: validate component, chassis and track JSON against @linelab/schema, then run
// catalog-wide checks (3D model fits, pin consistency, unique search aliases).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Chassis, Component, Track } from "@linelab/schema";
import { checkCatalog, validateTargets } from "../src/validate/index.js";

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

const fileOf = new Map(report.valid.map((v) => [v.data.id, v.file]));
const components = report.valid
  .filter((v) => v.label === "components")
  .map((v) => v.data as Component);
const catalog = checkCatalog(components).map((p) => ({
  file: fileOf.get(p.id) ?? p.id,
  message: p.message,
}));
// Track geometry (continuity, radii, features) is checked by `@linelab/sim-core`'s db:validate.
const problems = [...report.problems, ...catalog];

for (const p of problems) console.error(`✗ ${p.file}: ${p.message}`);
console.log(
  `db:validate — checked ${report.checked} file(s) (${components.length} components), ${problems.length} problem(s).`,
);
process.exitCode = problems.length > 0 ? 1 : 0;
