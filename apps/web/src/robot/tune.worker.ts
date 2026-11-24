/// <reference lib="webworker" />
// Twin calibration (CMA-ES) and the PID auto-tuner (Bayesian optimisation), off the main thread.
import { autotunePid, calibrateTwin } from "@linelab/calibrate";
import { getChassis, getComponent } from "@linelab/component-db";
import { resolveChassis } from "@linelab/design-core";
import { AvrController, resolveWiring } from "@linelab/firmware-runtime";
import { buildRobotModel, ReferencePid, type Controller, type RobotModel } from "@linelab/sim-core";
import type { Design } from "@linelab/schema";
import type { TuneRequest, TuneResponse } from "./tune-protocol";

const post = (m: TuneResponse) => {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);
};

function buildRobot(design: Design): RobotModel {
  const chassis = resolveChassis(design, getChassis);
  if (!chassis) throw new Error("The design's chassis can't be resolved.");
  return buildRobotModel(design, chassis, getComponent);
}

self.onmessage = (e: MessageEvent<TuneRequest>) => {
  const req = e.data;
  try {
    if (req.kind === "calibrate") {
      const fw = req.firmware;
      if (fw && fw.tier !== "emulated")
        throw new Error(
          "Calibrating against firmware needs an emulated board (Uno, Nano, Pro Mini).",
        );
      // The controller sees the candidate robot only through the wiring, which doesn't depend on
      // twin parameters; resolve it once.
      const wiring = fw
        ? resolveWiring(req.design, getComponent, buildRobot(req.design))
        : undefined;
      const makeController = (): Controller =>
        fw && wiring ? new AvrController(fw, wiring) : new ReferencePid();
      const result = calibrateTwin({
        design: req.design,
        buildRobot,
        track: req.track,
        recording: req.recording,
        makeController,
        maxEvals: req.maxEvals,
        onProgress: (p) => {
          post({
            id: req.id,
            kind: "progress",
            done: p.evals,
            total: p.maxEvals,
            best: p.bestError,
          });
        },
      });
      post({ id: req.id, kind: "calibrated", result });
    } else {
      const result = autotunePid({
        robot: buildRobot(req.design),
        track: req.track,
        iterations: req.iterations,
        onEval: (p) => {
          post({ id: req.id, kind: "progress", done: p.index + 1, total: p.total, best: p.best });
        },
      });
      post({ id: req.id, kind: "tuned", result });
    }
  } catch (err) {
    post({ id: req.id, kind: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
