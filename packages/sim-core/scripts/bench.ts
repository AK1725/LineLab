// `pnpm bench:sim`: simulated time ÷ wall time for the reference robot on a mix of tracks.
// Fails below 20× real time (BUILD_PLAN Phase 5). Wall-clock time is only used here, never in
// the simulator itself.
import { performance } from "node:perf_hooks";
import { ReferencePid } from "../src/sim/controller.js";
import { Simulation } from "../src/sim/simulation.js";
import { randomVariation } from "../src/sim/variation.js";
import { loadRobot, loadTrack, repoRoot } from "./lib.js";

const MIN_SPEEDUP = 20;
const { robot } = loadRobot(`${repoRoot}/packages/sim-core/fixtures/reference.design.json`);
const tracks = ["oval", "figure-eight", "inverted", "maze-grid", "random-curvy", "dashed"].map(
  loadTrack,
);

// Warm up the JIT.
new Simulation(robot, tracks[0] ?? loadTrack("oval"), new ReferencePid(), {
  durationMs: 2000,
}).run();

let simMs = 0;
let wallMs = 0;
let worst = Infinity;
for (const t of tracks) {
  for (const seed of [1, 2, 3]) {
    const t0 = performance.now();
    const r = new Simulation(robot, t, new ReferencePid(), {
      seed,
      variation: randomVariation(seed),
    }).run();
    const dt = performance.now() - t0;
    simMs += r.durationMs;
    wallMs += dt;
    worst = Math.min(worst, r.durationMs / dt);
  }
  console.log(`${t.id.padEnd(22)} ok`);
}
const speedup = simMs / wallMs;
console.log(
  `simulated ${(simMs / 1000).toFixed(1)} s in ${(wallMs / 1000).toFixed(2)} s: ${speedup.toFixed(0)}× real time overall, slowest run ${worst.toFixed(0)}×`,
);
if (speedup < MIN_SPEEDUP) {
  console.error(`✗ below ${MIN_SPEEDUP}× real time`);
  process.exitCode = 1;
}
