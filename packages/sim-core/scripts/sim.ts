// Headless runner:
//   pnpm sim --design d.json --track oval --controller ref --seeds 1..50 [--trace run.json] [--json]
// Seed 0 is the nominal robot; other seeds randomise friction, noise, light, battery, motor
// mismatch and start pose. `--track` takes a file or a built-in id.
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ReferencePid } from "../src/sim/controller.js";
import { toRunTrace } from "../src/sim/run.js";
import { Simulation } from "../src/sim/simulation.js";
import { NOMINAL, randomVariation } from "../src/sim/variation.js";
import { SimSetupError } from "../src/model/robot.js";
import { loadRobot, loadTrack, repoRoot } from "./lib.js";

const { values } = parseArgs({
  // pnpm passes a literal "--" through; ignore it.
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    design: {
      type: "string",
      default: `${repoRoot}/packages/sim-core/fixtures/reference.design.json`,
    },
    track: { type: "string", default: "oval" },
    controller: { type: "string", default: "ref" },
    seeds: { type: "string", default: "0" },
    laps: { type: "string", default: "1" },
    duration: { type: "string" },
    kp: { type: "string" },
    kd: { type: "string" },
    base: { type: "string" },
    trace: { type: "string" },
    json: { type: "boolean", default: false },
  },
});

function parseSeeds(spec: string): number[] {
  return spec.split(",").flatMap((part) => {
    const m = /^(\d+)\.\.(\d+)$/.exec(part.trim());
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      return Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
    }
    return [Number(part)];
  });
}

if (values.controller !== "ref") {
  console.error(
    `Unknown controller "${values.controller}". Only "ref" (reference PID) exists until firmware emulation (Phase 6).`,
  );
  process.exit(2);
}
const seeds = parseSeeds(values.seeds);
const track = loadTrack(values.track);
let robot;
try {
  robot = loadRobot(values.design).robot;
} catch (e) {
  if (e instanceof SimSetupError) {
    console.error(e.message);
    process.exit(2);
  }
  throw e;
}
const pid = {
  ...(values.kp ? { kp: Number(values.kp) } : {}),
  ...(values.kd ? { kd: Number(values.kd) } : {}),
  ...(values.base ? { baseDuty: Number(values.base) } : {}),
};

const rows = seeds.map((seed) => {
  const sim = new Simulation(robot, track, new ReferencePid(pid), {
    seed,
    laps: Number(values.laps),
    variation: seed === 0 ? NOMINAL : randomVariation(seed),
    ...(values.duration ? { durationMs: Number(values.duration) } : {}),
  });
  const r = sim.run();
  if (values.trace && seed === seeds[0]) {
    writeFileSync(
      values.trace,
      `${JSON.stringify(toRunTrace(r, { runId: `cli-${seed}`, seed, designHash: "cli", trackId: track.id }))}\n`,
    );
  }
  return {
    seed,
    outcome: r.outcome,
    ...r.metrics,
    hash: r.hash,
    events: r.events.map((e) => e.type),
  };
});

const ok = rows.filter((r) => r.outcome === "finished").length;
if (values.json)
  console.log(
    JSON.stringify({ track: track.id, robustness: ok / rows.length, runs: rows }, null, 2),
  );
else {
  console.log(
    `${track.name} — ${rows.length} run(s)${robot.notes.length ? `\nnotes: ${robot.notes.join(" ")}` : ""}`,
  );
  console.log("seed  outcome    done   lap s   mean/max err mm   osc Hz   energy J");
  for (const r of rows) {
    console.log(
      `${String(r.seed).padStart(4)}  ${r.outcome.padEnd(9)} ${r.completionPct.toFixed(0).padStart(4)}%  ${r.lapTimeMs !== undefined ? (r.lapTimeMs / 1000).toFixed(2).padStart(6) : "     -"}   ${r.meanLateralErrorMm.toFixed(1).padStart(6)} / ${r.maxLateralErrorMm.toFixed(0).padStart(4)}     ${(r.oscillationIndex ?? 0).toFixed(2).padStart(5)}   ${(r.energyJ ?? 0).toFixed(1).padStart(7)}`,
    );
  }
  console.log(
    `robustness: ${ok}/${rows.length} finished (${((ok / rows.length) * 100).toFixed(0)} %)`,
  );
}
