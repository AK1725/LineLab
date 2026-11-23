/// <reference lib="webworker" />
import { getChassis, getComponent } from "@linelab/component-db";
import { resolveChassis } from "@linelab/design-core";
import { AvrController, HalRunner, resolveWiring } from "@linelab/firmware-runtime";
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
  type RobotModel,
  type SimResult,
} from "@linelab/sim-core";
import type { Design, FirmwareArtifact } from "@linelab/schema";
import type { FirmwareReport, RunRequest, RunResponse, RunSummary } from "./protocol";

const RECORD_MS = 10;

function post(msg: RunResponse, transfer: Transferable[] = []) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);
}

/** One firmware run; `detail` collects serial, watches and the profile (the replayed seed). */
function runFirmwareSeed(
  design: Design,
  robot: RobotModel,
  field: TrackField,
  artifact: FirmwareArtifact,
  config: ConstructorParameters<typeof Simulation>[3],
  detail: boolean,
  alive: (simMs: number) => void,
): { result: SimResult; report: FirmwareReport } {
  const wiring = resolveWiring(design, getComponent, robot);
  const t0 = performance.now();
  if (artifact.tier === "emulated") {
    const c = new AvrController(artifact, wiring, { profile: detail });
    const sim = new Simulation(robot, field, c, config);
    const names = detail ? c.watchList().map((w) => w.name) : [];
    const samples: number[][] = names.map(() => []);
    const sample = () => {
      const w = c.watch();
      names.forEach((n, i) => samples[i]?.push(w[n] ?? 0));
    };
    if (detail) sample();
    while (!sim.done) {
      sim.step();
      if (detail && sim.tMs % RECORD_MS === 0) sample();
      if (sim.tMs % 2000 === 0) alive(sim.tMs);
    }
    const result = sim.result();
    return {
      result,
      report: {
        tier: "emulated",
        serial: c.serial,
        resets: c.resetCount,
        loop: c.loopStats(),
        wiringProblems: wiring.problems,
        hotLines: detail
          ? c.hotLines(12).map(({ file, line, share }) => ({ file, line, share }))
          : [],
        hotFiles: detail ? c.hotFiles().slice(0, 8) : [],
        watch: { names, types: c.watchList().map((w) => w.type), samples },
        speed: result.durationMs / Math.max(1, performance.now() - t0),
      },
    };
  }
  const sim = new Simulation(robot, field, HalRunner.controllerFor(wiring), config);
  const runner = new HalRunner(sim, artifact, wiring, (ms) => {
    if (ms % 2000 === 0) alive(ms);
  });
  const result = runner.run();
  return {
    result,
    report: {
      tier: "hal",
      serial: runner.serial,
      resets: runner.resets,
      loop: runner.loopStats(),
      wiringProblems: wiring.problems,
      speed: result.durationMs / Math.max(1, performance.now() - t0),
    },
  };
}

self.onmessage = (e: MessageEvent<RunRequest>) => {
  const req = e.data;
  try {
    const chassis = resolveChassis(req.design, getChassis);
    if (!chassis) throw new SimSetupError(["The design's chassis is unknown."]);
    const robot = buildRobotModel(req.design, chassis, getComponent);
    const field = new TrackField(req.track, SIM_FIELD);
    const runs: MonteCarloRun[] = [];
    let main: { summary: RunSummary; trace: SimResult["trace"] } | undefined;
    req.seeds.forEach((seed, i) => {
      const config = {
        seed,
        laps: req.laps,
        recordEveryMs: i === 0 ? RECORD_MS : 50,
        variation: seed === 0 ? NOMINAL : randomVariation(seed),
      };
      let r: SimResult;
      let firmware: FirmwareReport | undefined;
      if (req.firmware) {
        const out = runFirmwareSeed(
          req.design,
          robot,
          field,
          req.firmware,
          config,
          i === 0,
          (simMs) => {
            post({ id: req.id, kind: "alive", simMs });
          },
        );
        r = out.result;
        firmware = out.report;
      } else r = new Simulation(robot, field, new ReferencePid(req.pid), config).run();
      runs.push({ seed, outcome: r.outcome, metrics: r.metrics, hash: r.hash });
      if (i === 0) {
        main = {
          summary: {
            seed,
            outcome: r.outcome,
            // For firmware, the loop rate is measured (time between reads of the first sensor).
            metrics:
              firmware?.loop && firmware.loop.medianMs > 0
                ? { ...r.metrics, loopFrequencyHz: 1000 / firmware.loop.medianMs }
                : r.metrics,
            events: r.events,
            notes: r.notes,
            hash: r.hash,
            durationMs: r.durationMs,
            recordEveryMs: RECORD_MS,
            sensorsMm: robot.sensors.map((s) => ({ x: s.xMm, y: s.yMm })),
            controller: req.firmware ? "firmware" : "reference",
            ...(firmware ? { firmware } : {}),
          },
          trace: r.trace,
        };
      }
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
