/**
 * @linelab/firmware-runtime: runs the user's firmware as the robot's controller.
 * - Emulated tier: compiled ATmega328P firmware on avr8js, cycle-accurate (Uno, Nano, Pro Mini).
 * - HAL tier: other boards' sketches compiled to WebAssembly against @linelab/lfr-hal; timing is
 *   approximate.
 */
import type { Lookup } from "@linelab/design-core";
import { Simulation, type RobotModel, type SimConfig, type SimResult } from "@linelab/sim-core";
import type { Design, FirmwareArtifact, SourceLoc, Track } from "@linelab/schema";
import { AvrController } from "./avr-controller.js";
import type { periodStats } from "./debug.js";
import { HalRunner } from "./hal.js";
import { resolveWiring, type FirmwareWiring } from "./wiring.js";

export * from "./hex.js";
export * from "./boards.js";
export * from "./drivers.js";
export * from "./wiring.js";
export * from "./avr.js";
export * from "./avr-controller.js";
export * from "./hal.js";
export * from "./debug.js";

export interface FirmwareRun {
  result: SimResult;
  serial: string;
  resets: number;
  wiring: FirmwareWiring;
  loop: ReturnType<typeof periodStats>;
  /** Emulated tier only. */
  hotLines?: ReturnType<AvrController["hotLines"]>;
  hotFiles?: ReturnType<AvrController["hotFiles"]>;
  /** Emulated tier only: the sketch's globals at the end of the run. */
  watch?: Record<string, number>;
  /** For the detectors. */
  sampleTimesMs: number[];
  longCalls: { atMs: number; durationMs: number; loc?: SourceLoc }[];
  stalls: { atMs: number; durationMs: number; loc?: SourceLoc }[];
  /** Emulated tier: globals sampled every `watchEveryMs`. */
  watchSeries?: { names: string[]; samples: number[][] };
}

/** Simulate a robot running compiled firmware on a track. */
export function runFirmware(args: {
  design: Design;
  lookup: Lookup;
  robot: RobotModel;
  track: Track;
  artifact: FirmwareArtifact;
  config?: Partial<SimConfig>;
  profile?: boolean;
  /** Watch sampling period (ms), emulated tier. */
  watchEveryMs?: number;
  /** Called every ms with the emulated controller (emulated tier), e.g. to sample watches. */
  onTick?: (c: AvrController, sim: Simulation) => void;
}): FirmwareRun {
  const wiring = resolveWiring(args.design, args.lookup, args.robot);
  if (args.artifact.tier === "emulated") {
    const c = new AvrController(args.artifact, wiring, { profile: args.profile ?? false });
    const sim = new Simulation(args.robot, args.track, c, args.config);
    const every = args.watchEveryMs ?? 10;
    const names = c.watchList().map((w) => w.name);
    const samples: number[][] = names.map(() => []);
    const sample = () => {
      const w = c.watch();
      names.forEach((n, i) => samples[i]?.push(w[n] ?? 0));
    };
    sample();
    while (!sim.done) {
      sim.step();
      if (sim.tMs % every === 0) sample();
      args.onTick?.(c, sim);
    }
    return {
      result: sim.result(),
      serial: c.serial,
      resets: c.resetCount,
      wiring,
      loop: c.loopStats(),
      hotLines: c.hotLines(25),
      hotFiles: c.hotFiles(),
      watch: c.watch(),
      sampleTimesMs: c.sampleTimesMs(),
      longCalls: c.longCalls(),
      stalls: c.stalls(),
      watchSeries: { names, samples },
    };
  }
  const sim = new Simulation(args.robot, args.track, HalRunner.controllerFor(wiring), args.config);
  const runner = new HalRunner(sim, args.artifact, wiring);
  const result = runner.run();
  return {
    result,
    serial: runner.serial,
    resets: runner.resets,
    wiring,
    loop: runner.loopStats(),
    sampleTimesMs: runner.sampleTimesMs(),
    longCalls: runner.longCalls(),
    stalls: [],
  };
}
