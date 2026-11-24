// Generates fixtures/hidden-twin.recording.json: a SYNTHETIC telemetry recording of the
// reference robot with hidden twin parameters (fixtures/hidden-twin.truth.json) running the
// reference PID on the oval, sampled at 10 ms like LineLabTelemetry. It stands in for a real-robot
// recording until one is contributed (docs/PROGRESS.md). Run: pnpm --filter @linelab/calibrate fixture:generate
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ReferencePid } from "@linelab/sim-core";
import { syntheticRecording } from "../src/synthetic.js";
import { buildRobot, referenceDesign, repo, track } from "../src/test-kit.js";

const hidden = {
  frictionMu: 0.75,
  motorKtScaleLeft: 0.88,
  motorKtScaleRight: 1.05,
  driverDropV: 1.6,
  sensorGain: 0.78,
  sensorOffset: 0.06,
  sensorNoiseStd: 0.014,
  latencyMs: 4,
};
const rec = syntheticRecording({
  design: referenceDesign(),
  buildRobot,
  hidden,
  track: track("oval"),
  makeController: () => new ReferencePid(),
  durationMs: 5000,
  seed: 4242, // a different noise realisation from the calibrator's
  name: "hidden-twin (synthetic)",
});
const dir = join(repo, "packages", "calibrate", "fixtures");
writeFileSync(join(dir, "hidden-twin.recording.json"), `${JSON.stringify(rec)}\n`);
writeFileSync(join(dir, "hidden-twin.truth.json"), `${JSON.stringify(hidden, null, 2)}\n`);
console.log(`${rec.samples.length} samples written`);
