// `pnpm --filter @linelab/agent inject-bugs`: synthetic bug → fix cases for the knowledge base
// (BLUEPRINT §8.9 seeding). Each mutation operator injects a classic line-follower bug into the
// known-good sketch. The mutant is compiled and simulated on the reference robot; it is kept only
// if LineLab detects a failure that the original doesn't have. The case's fix is the reverse diff,
// which by construction restores the verified original. Output: examples/knowledge/seed.json,
// every case labelled synthetic (verified in simulation, never on a real robot).
// Needs a compiler: ARDUINO_CLI (+ ARDUINO_DATA_DIR) or COMPILER_URL.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getChassis, getComponent } from "@linelab/component-db";
import { compile, configFromEnv } from "@linelab/compiler";
import { resolveChassis } from "@linelab/design-core";
import { Design, Track } from "@linelab/schema";
import { CachedCompiler, HttpCompiler, type Compiler } from "../src/compiler.js";
import type { NewCase } from "../src/knowledge.js";
import { makeUnifiedDiff } from "../src/patch.js";
import { Workbench, type OkEvaluation } from "../src/workbench.js";

const repo = join(import.meta.dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const FILE = "good_pid.ino";
const original = read("examples/firmware/good_pid/good_pid.ino");

interface Mutation {
  id: string;
  /** What the bug is, as a diagnosis would say it. */
  diagnosis: string;
  apply: (s: string) => string;
}

const sub = (re: RegExp, to: string) => (s: string) => {
  if (!re.test(s)) throw new Error(`pattern ${String(re)} not found`);
  return s.replace(re, to);
};

const MUTATIONS: Mutation[] = [
  ...[0.24, 0.4].map((kp) => ({
    id: `kp-${String(kp)}`,
    diagnosis: `Kp = ${String(kp)} is too high for this robot: the steering overcorrects and the robot oscillates around the line, worse at speed.`,
    apply: sub(/float Kp = 0\.08;/, `float Kp = ${String(kp)};`),
  })),
  {
    id: "kd-zero",
    diagnosis:
      "Kd = 0: with no derivative term nothing damps the proportional steering, so the robot weaves and overshoots corners.",
    apply: sub(/float Kd = 2\.5;/, "float Kd = 0;"),
  },
  ...[15, 30].map((ms) => ({
    id: `delay-${String(ms)}`,
    diagnosis: `delay(${String(ms)}) at the end of loop() blocks the controller: sensors are read and motors updated only every ~${String(ms)} ms, so the robot reacts late and overshoots.`,
    apply: sub(/(\n {2}if \(millis\(\) - lastPrint >= 250\) \{)/, `\n  delay(${String(ms)});$1`),
  })),
  {
    id: "left-motor-inverted",
    diagnosis:
      "The left motor's direction pins are written the wrong way round (AIN1/AIN2 swapped), so it drives backwards when told to go forwards.",
    apply: sub(/setMotor\(PWMA, AIN1, AIN2,/, "setMotor(PWMA, AIN2, AIN1,"),
  },
  {
    id: "steering-sign",
    diagnosis:
      "The steering correction has the wrong sign: the robot turns away from the line instead of towards it.",
    apply: (s) =>
      sub(
        /setMotor\(PWMB, BIN1, BIN2, base \+ \(int\)turn\);/,
        "setMotor(PWMB, BIN1, BIN2, base - (int)turn);",
      )(
        sub(
          /setMotor\(PWMA, AIN1, AIN2, base - \(int\)turn\);/,
          "setMotor(PWMA, AIN1, AIN2, base + (int)turn);",
        )(s),
      ),
  },
  {
    id: "sensor-order-reversed",
    diagnosis:
      "The sensor array is read in reverse order (A7..A0) relative to the weights, so the error sign is flipped and the robot steers away from the line.",
    apply: sub(/\{A0, A1, A2, A3, A4, A5, A6, A7\}/, "{A7, A6, A5, A4, A3, A2, A1, A0}"),
  },
  {
    id: "too-fast",
    diagnosis:
      "baseSpeed = 230 is too fast for these gains and this track: the robot can't make the corners and runs off.",
    apply: sub(/int baseSpeed = 115;/, "int baseSpeed = 230;"),
  },
  {
    id: "no-line-lost-recovery",
    diagnosis:
      "When the line is lost the error is set to 0, so the robot drives straight off instead of turning back towards where the line was.",
    apply: sub(/if \(lost\) error = lastError >= 0 \? 3500 : -3500;/, "if (lost) error = 0;"),
  },
  {
    id: "pwm-pin-wrong",
    diagnosis:
      "PWMA is defined as pin 6 but the driver's PWMA is wired to D3, so the left motor never gets a speed signal.",
    apply: sub(/const uint8_t PWMA = 3,/, "const uint8_t PWMA = 6,"),
  },
];

let inner: Compiler | undefined;
if (process.env.ARDUINO_CLI) {
  const cfg = configFromEnv();
  inner = { compile: (r) => compile(r, cfg) };
} else if (process.env.COMPILER_URL) inner = new HttpCompiler(process.env.COMPILER_URL);
else {
  console.error(
    "inject-bugs compiles mutants: set ARDUINO_CLI (+ ARDUINO_DATA_DIR) or COMPILER_URL.",
  );
  process.exit(2);
}
const compiler = new CachedCompiler(join(repo, "examples", "firmware", ".compile-cache"), inner);
const design = Design.parse(JSON.parse(read("packages/sim-core/fixtures/reference.design.json")));
const chassis = resolveChassis(design, getChassis);
if (!chassis) throw new Error("chassis");
const parts = [
  ...new Set(
    design.placements.map((p) => p.componentId).filter((id) => /^(mcu|driver|sensor)\./.test(id)),
  ),
];

const summary = (e: OkEvaluation) =>
  [
    `${String(Math.round(e.robustness * 100))} % of runs finished, mean completion ${String(Math.round(e.meanCompletionPct))} %`,
    ...[...new Set(e.seeds.flatMap((s) => s.errors))].map((t) => `error: ${t.replace(/_/g, " ")}`),
    ...[...new Set(e.seeds.flatMap((s) => s.warnings))]
      .slice(0, 3)
      .map((t) => `warning: ${t.replace(/_/g, " ")}`),
  ].join("; ");

/** One case per mutation (the fix is the same diff on every track); symptoms from each track. */
const cases = new Map<string, NewCase>();
for (const trackId of ["oval", "s-curves", "right-angles"]) {
  const wb = new Workbench(
    {
      design,
      chassis,
      lookup: getComponent,
      track: Track.parse(JSON.parse(read(`tracks/track.${trackId}.json`))),
      board: "arduino:avr:nano",
      file: FILE,
      seeds: [0],
      freshSeeds: [1, 2],
    },
    compiler,
  );
  const base = await wb.evaluate(original);
  if (!base.ok) throw new Error("the original doesn't compile");
  const baseErrors = new Set(base.seeds.flatMap((s) => s.errors));
  for (const m of MUTATIONS) {
    const mutant = m.apply(original);
    const r = await wb.evaluate(mutant);
    if (!r.ok) {
      console.log(`- ${m.id} on ${trackId}: doesn't compile, skipped`);
      continue;
    }
    const newErrors = [...new Set(r.seeds.flatMap((s) => s.errors))].filter(
      (t) => !baseErrors.has(t),
    );
    const worse =
      r.robustness < base.robustness || r.meanCompletionPct < base.meanCompletionPct - 5;
    if (newErrors.length === 0 && !worse) {
      console.log(`- ${m.id} on ${trackId}: no failure detected, skipped`);
      continue;
    }
    const symptoms = `On the ${trackId} track: ${summary(r)}.`;
    const prev = cases.get(m.id);
    if (prev) prev.symptoms = `${prev.symptoms}\n${symptoms}`;
    else
      cases.set(m.id, {
        symptoms,
        diagnosis: m.diagnosis,
        diff: makeUnifiedDiff(mutant, original, FILE),
        source: "synthetic",
        parts,
      });
    console.log(
      `✓ ${m.id} on ${trackId}: ${newErrors.join(", ") || "robustness/completion dropped"}`,
    );
  }
}
const out = join(repo, "examples", "knowledge");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "seed.json"), `${JSON.stringify([...cases.values()], null, 2)}\n`);
console.log(`${String(cases.size)} synthetic cases written to examples/knowledge/seed.json`);
