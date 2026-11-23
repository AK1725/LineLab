/// <reference lib="webworker" />
import { getChassis, getComponent } from "@linelab/component-db";
import { resolveChassis } from "@linelab/design-core";
import {
  buildRobotModel,
  NOMINAL,
  randomVariation,
  ReferencePid,
  SIM_FIELD,
  Simulation,
  SimSetupError,
  TrackField,
  type MonteCarloRun,
} from "@linelab/sim-core";
import type { RunRequest, RunResponse } from "./protocol";

const RECORD_MS = 10;

function post(msg: RunResponse, transfer: Transferable[] = []) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);
}

self.onmessage = (e: MessageEvent<RunRequest>) => {
  const req = e.data;
  try {
    const chassis = resolveChassis(req.design, getChassis);
    if (!chassis) throw new SimSetupError(["The design's chassis is unknown."]);
    const robot = buildRobotModel(req.design, chassis, getComponent);
    const field = new TrackField(req.track, SIM_FIELD);
    const runs: MonteCarloRun[] = [];
    let main:
      | {
          summary: Extract<RunResponse, { kind: "result" }>["main"];
          trace: Extract<RunResponse, { kind: "result" }>["trace"];
        }
      | undefined;
    req.seeds.forEach((seed, i) => {
      const sim = new Simulation(robot, field, new ReferencePid(req.pid), {
        seed,
        laps: req.laps,
        recordEveryMs: i === 0 ? RECORD_MS : 50,
        variation: seed === 0 ? NOMINAL : randomVariation(seed),
      });
      const r = sim.run();
      runs.push({ seed, outcome: r.outcome, metrics: r.metrics, hash: r.hash });
      if (i === 0) {
        main = {
          summary: {
            seed,
            outcome: r.outcome,
            metrics: r.metrics,
            events: r.events,
            notes: r.notes,
            hash: r.hash,
            durationMs: r.durationMs,
            recordEveryMs: RECORD_MS,
            sensorsMm: robot.sensors.map((s) => ({ x: s.xMm, y: s.yMm })),
          },
          trace: r.trace,
        };
      }
      if (req.seeds.length > 1)
        post({ id: req.id, kind: "progress", done: i + 1, total: req.seeds.length });
    });
    if (!main) throw new Error("No seeds to run.");
    const ok = runs.filter((r) => r.outcome === "finished").length;
    post(
      {
        id: req.id,
        kind: "result",
        main: main.summary,
        trace: main.trace,
        runs,
        robustness: ok / runs.length,
      },
      [main.trace.data.buffer],
    );
  } catch (err) {
    post(
      err instanceof SimSetupError
        ? { id: req.id, kind: "error", message: err.message, issues: err.issues }
        : { id: req.id, kind: "error", message: (err as Error).message },
    );
  }
};
