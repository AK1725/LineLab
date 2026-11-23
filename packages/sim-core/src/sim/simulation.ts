import type { RunMetrics, SimEvent, Track } from "@linelab/schema";
import { Battery } from "../model/battery.js";
import { motorStep, type MotorParams } from "../model/motor.js";
import type { RobotModel } from "../model/robot.js";
import {
  footprintPoints,
  footprintRadiusMm,
  readChannel,
  RC_TIMEOUT_US,
  type SensorEnv,
} from "../model/sensor.js";
import { Prng } from "../prng.js";
import { ProgressTracker, TrackField } from "../track/geometry.js";
import type { Controller, MotorCommand } from "./controller.js";
import { hashFloat64 } from "./hash.js";
import { NOMINAL, type Variation } from "./variation.js";

/** Tyre slip speed at which friction reaches ~76 % of μN (tanh(1)); smooths stick/slip. */
export const SLIP_SPEED_MPS = 0.05;
/** Same smoothing for casters and dragging edges. */
const CASTER_SLIP_MPS = 0.01;
/** How long the MCU stays in reset after a brownout. */
export const BROWNOUT_RESET_MS = 100;

export interface SimConfig {
  seed: number;
  /** Physics/control tick (ms). The integrator sub-steps inside it when the contact model is stiff. */
  dtMs: number;
  /** Stop after this long even if not finished (default from track length). */
  durationMs?: number;
  /** Laps of a closed track to finish. */
  laps: number;
  /** Trace sample period (ms). */
  recordEveryMs: number;
  /** Sensor-to-controller latency (ms). */
  latencyMs: number;
  /** Off track: both the robot centre and the sensor array this far from the line... */
  offTrackMm: number;
  /** ...for this long. */
  offTrackForMs: number;
  /** Stuck: less than 30 mm of progress in this long. */
  stuckForMs: number;
  variation: Variation;
}

export const DEFAULT_CONFIG: SimConfig = {
  seed: 1,
  dtMs: 1,
  laps: 1,
  recordEveryMs: 10,
  latencyMs: 0,
  offTrackMm: 100,
  offTrackForMs: 500,
  stuckForMs: 3000,
  variation: NOMINAL,
};

/** Track sampling for simulation: 2 mm centreline steps in a 10 mm grid (fast sensor lookups). */
export const SIM_FIELD = { stepMm: 2, cellMm: 10 } as const;

export type Outcome = "finished" | "off_track" | "stuck" | "timeout";

/** Recorded channels, in column order. Sensor readings follow as s0..s(n-1). */
export const TRACE_CHANNELS = [
  "tMs",
  "xMm",
  "yMm",
  "headingRad",
  "vMmS",
  "omegaRadS",
  "pwmLeft",
  "pwmRight",
  "batteryV",
  "logicV",
  "lateralMm",
  "progressMm",
  "currentLeftA",
  "currentRightA",
  "wheelLeftRadS",
  "wheelRightRadS",
] as const;
export type TraceChannel = (typeof TRACE_CHANNELS)[number];

/** Row-major trace: `stride` numbers per sample; transferable to and from workers. */
export interface PackedTrace {
  stride: number;
  count: number;
  sensorCount: number;
  data: Float64Array;
}

export const channelIndex = (c: TraceChannel) => TRACE_CHANNELS.indexOf(c);

export interface SimResult {
  outcome: Outcome;
  metrics: RunMetrics;
  events: SimEvent[];
  trace: PackedTrace;
  /** Hash of the trace and outcome: identical inputs give an identical hash. */
  hash: string;
  durationMs: number;
  notes: string[];
}

interface WheelState {
  m: MotorParams;
  mu: number;
  radiusM: number;
  inertia: number;
  px: number;
  py: number;
  loadN: number;
  omega: number;
  currentA: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export function isClosedTrack(field: TrackField): boolean {
  const s = field.path.samples;
  const a = s[0];
  const z = s.at(-1);
  return a !== undefined && z !== undefined && Math.hypot(a.x - z.x, a.y - z.y) < 1;
}

/**
 * Deterministic differential-drive simulation at a fixed tick. Same robot, track, controller,
 * config and seed give a bit-identical trace (no wall clock, no Math.random).
 */
export class Simulation {
  readonly field: TrackField;
  readonly config: SimConfig;
  readonly durationMs: number;
  tMs = 0;
  outcome: Outcome | undefined;
  readonly events: SimEvent[] = [];

  // Body state: CoG position (m, world), heading, body-frame velocities at the CoG.
  private X = 0;
  private Y = 0;
  private theta = 0;
  private u = 0;
  private w = 0;
  private r = 0;
  private readonly wheels: [WheelState, WheelState];
  private readonly battery: Battery;
  private readonly rng: Prng;
  private readonly env: SensorEnv;
  private readonly substeps: number;
  private readonly tracker: ProgressTracker;
  /** Follows the point under the sensor array, for the lateral error. */
  private readonly sensorTracker: ProgressTracker;
  private readonly closed: boolean;
  private readonly adcMax: number;
  private readonly offsetsMm: number[];
  private readonly arrayCentre: { x: number; y: number };
  private readonly sensorRadius: number[];
  private readonly sensorPoints: (readonly [number, number, number])[][];
  private readonly delayed: number[][] = [];
  private duty: MotorCommand = { left: 0, right: 0 };
  private batteryCurrentA = 0;
  private batteryV = 0;
  private logicV = 0;
  private resetUntilMs = -1;
  private brownedOut = false;
  private lastReadings: number[] = [];
  private lateralMm = 0;
  private progressMm = 0;
  private lapsDone = 0;
  private lapTimeMs: number | undefined;
  private offSinceMs: number | undefined;
  private bestProgress = 0;
  private bestProgressAtMs = 0;
  // Metrics accumulators.
  private sumAbsLat = 0;
  private maxAbsLat = 0;
  private latSamples = 0;
  private energyJ = 0;
  private crossings = 0;
  private latSign = 0;
  // Trace.
  private readonly stride: number;
  private data: Float64Array;
  private count = 0;

  constructor(
    readonly robot: RobotModel,
    track: Track | TrackField,
    readonly controller: Controller,
    config: Partial<SimConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    const v = this.config.variation;
    this.field = track instanceof TrackField ? track : new TrackField(track, SIM_FIELD);
    this.closed = isClosedTrack(this.field);
    this.tracker = new ProgressTracker(this.field);
    this.sensorTracker = new ProgressTracker(this.field);
    const L = this.field.path.length;
    this.durationMs =
      this.config.durationMs ??
      Math.min(180_000, 5000 + Math.round(((this.closed ? this.config.laps : 1) * L) / 0.2));
    this.rng = new Prng(this.config.seed);
    this.env = { ambient: v.ambient, noiseStd: v.sensorNoiseStd, gain: 1, offset: 0 };
    this.battery = new Battery(robot.battery.spec, v.soc);
    this.adcMax = 2 ** robot.logic.adcBits - 1;

    const cog = robot.cogM;
    const wheel = (i: 0 | 1, kt: number): WheelState => {
      const wm = robot.wheels[i];
      return {
        m: { ...wm.motor, ktNmPerA: wm.motor.ktNmPerA * kt, keVsPerRad: wm.motor.keVsPerRad * kt },
        mu: wm.mu * v.frictionScale,
        radiusM: wm.radiusM,
        inertia: wm.inertiaKgM2,
        px: wm.xM - cog.x,
        py: wm.yM - cog.y,
        loadN: robot.wheelLoadN[i],
        omega: 0,
        currentA: 0,
      };
    };
    this.wheels = [wheel(0, v.ktScaleLeft), wheel(1, v.ktScaleRight)];

    // Sub-steps: keep h·k < 0.4 for the stiffest contact (tyre slip vs wheel inertia, lateral
    // grip vs body mass, and the yaw equivalent).
    const k = Math.max(
      ...this.wheels.map(
        (s) => (((s.mu * s.loadN) / SLIP_SPEED_MPS) * (s.radiusM * s.radiusM)) / s.inertia,
      ),
      this.wheels.reduce((s, x) => s + (x.mu * x.loadN) / SLIP_SPEED_MPS, 0) / robot.massKg,
      this.wheels.reduce(
        (s, x) => s + ((x.mu * x.loadN) / SLIP_SPEED_MPS) * (x.px * x.px + x.py * x.py),
        0,
      ) / robot.yawInertiaKgM2,
      ...robot.casters.map(
        (c, i) =>
          ((c.coefficient * (robot.casterLoadN[i] ?? 0)) / CASTER_SLIP_MPS) *
          Math.max(
            1 / robot.massKg,
            ((c.xM - cog.x) ** 2 + (c.yM - cog.y) ** 2) / robot.yawInertiaKgM2,
          ),
      ),
    );
    this.substeps = clamp(Math.ceil((k * this.config.dtMs) / 1000 / 0.4), 1, 64);

    const n = robot.sensors.length;
    this.arrayCentre = {
      x: robot.sensors.reduce((s, c) => s + c.xMm, 0) / Math.max(1, n),
      y: robot.sensors.reduce((s, c) => s + c.yMm, 0) / Math.max(1, n),
    };
    this.offsetsMm = robot.sensors.map((c) => c.yMm - this.arrayCentre.y);
    this.sensorRadius = robot.sensors.map((c) => footprintRadiusMm(c.heightMm));
    this.sensorPoints = this.sensorRadius.map((r) => footprintPoints(r));

    // Start pose (robot origin = drive-axle midpoint) with jitter.
    const s = this.field.track.start;
    const ox = s.x + v.startDxMm;
    const oy = s.y + v.startDyMm;
    this.theta = s.headingRad + v.startDHeadingRad;
    this.X = ox / 1000 + cog.x * Math.cos(this.theta) - cog.y * Math.sin(this.theta);
    this.Y = oy / 1000 + cog.x * Math.sin(this.theta) + cog.y * Math.cos(this.theta);
    this.batteryV = this.battery.terminalVoltage(robot.logic.currentA);
    this.logicV = Math.min(robot.logic.voltageV, this.batteryV - robot.logic.dropoutV);

    this.stride = TRACE_CHANNELS.length + n;
    this.data = new Float64Array(
      this.stride * (Math.ceil(this.durationMs / this.config.recordEveryMs) + 2),
    );
    this.tracker.update(ox, oy);
  }

  /** Robot origin (axle midpoint) pose in mm/rad. */
  pose() {
    const c = this.robot.cogM;
    const ct = Math.cos(this.theta);
    const st = Math.sin(this.theta);
    return {
      x: (this.X - (c.x * ct - c.y * st)) * 1000,
      y: (this.Y - (c.x * st + c.y * ct)) * 1000,
      headingRad: this.theta,
    };
  }

  get done(): boolean {
    return this.outcome !== undefined;
  }

  private readSensors(): number[] {
    const p = this.pose();
    const ct = Math.cos(p.headingRad);
    const st = Math.sin(p.headingRad);
    const max =
      this.robot.sensors[0]?.output === "digital"
        ? 1
        : this.robot.sensors[0]?.output === "rc"
          ? RC_TIMEOUT_US
          : this.adcMax;
    return this.robot.sensors.map((ch, i) => {
      const x = p.x + ch.xMm * ct - ch.yMm * st;
      const y = p.y + ch.xMm * st + ch.yMm * ct;
      const refl = this.field.meanReflectance(
        x,
        y,
        this.sensorPoints[i] ?? [],
        this.sensorRadius[i] ?? 1,
      );
      return readChannel(ch, refl, this.env, max, this.rng);
    });
  }

  /** Advance one tick. */
  step(): void {
    if (this.done) return;
    const dtMs = this.config.dtMs;
    const robot = this.robot;

    // 1. Sensors (with latency) and controller.
    const fresh = this.readSensors();
    this.delayed.push(fresh);
    const lagTicks = Math.round(this.config.latencyMs / dtMs);
    while (this.delayed.length > lagTicks + 1) this.delayed.shift();
    const readings = this.delayed[0] ?? fresh;
    this.lastReadings = readings;
    if (this.tMs >= this.resetUntilMs) {
      const out = robot.sensors[0]?.output ?? "analog";
      const cmd = this.controller.tick({
        tMs: this.tMs,
        sensors: readings,
        sensorMax: out === "digital" ? 1 : out === "rc" ? RC_TIMEOUT_US : this.adcMax,
        sensorOutput: out,
        channelOffsetsMm: this.offsetsMm,
      });
      if (cmd) this.duty = { left: clamp(cmd.left, -1, 1), right: clamp(cmd.right, -1, 1) };
    } else this.duty = { left: 0, right: 0 };

    // 2. Physics.
    const h = dtMs / 1000 / this.substeps;
    for (let k = 0; k < this.substeps; k++) this.integrate(h);

    // 3. Power: brownout resets the MCU.
    this.logicV = Math.max(0, Math.min(robot.logic.voltageV, this.batteryV - robot.logic.dropoutV));
    if (!this.brownedOut && this.logicV < robot.logic.brownoutV) {
      this.brownedOut = true;
      this.resetUntilMs = this.tMs + BROWNOUT_RESET_MS;
      this.controller.reset();
      this.events.push({
        tMs: this.tMs,
        type: "brownout",
        severity: "error",
        data: { logicV: round3(this.logicV), batteryV: round3(this.batteryV) },
      });
    } else if (this.brownedOut && this.logicV > robot.logic.brownoutV + 0.2)
      this.brownedOut = false;

    this.tMs += dtMs;
    this.observe();
    if (this.tMs % this.config.recordEveryMs === 0) this.record();
    // finish() ignores a second outcome, so a run that just ended keeps its real outcome.
    if (this.tMs >= this.durationMs) this.finish("timeout");
  }

  private integrate(h: number): void {
    const robot = this.robot;
    const vbat = this.battery.terminalVoltage(this.batteryCurrentA);
    this.batteryV = vbat;
    let fx = 0;
    let fy = 0;
    let mz = 0;
    let ibat = robot.logic.currentA;
    const duties = [this.duty.left, this.duty.right];
    this.wheels.forEach((s, i) => {
      const d = duties[i] ?? 0;
      const drop =
        robot.driver.dropV *
        (0.6 + 0.4 * Math.min(1, Math.abs(s.currentA) / robot.driver.continuousA));
      const vm = d * Math.max(0, vbat - drop);
      const { currentA, torqueNm } = motorStep(s.m, vm, s.omega, robot.driver.peakA);
      s.currentA = currentA;
      // H-bridge supply current: duty × motor current (negative when regenerating).
      ibat += d * currentA;
      const vpx = this.u - this.r * s.py;
      const vpy = this.w + this.r * s.px;
      const n = s.mu * s.loadN;
      let flong = n * Math.tanh((s.omega * s.radiusM - vpx) / SLIP_SPEED_MPS);
      let flat = -n * Math.tanh(vpy / SLIP_SPEED_MPS);
      const mag = Math.hypot(flong, flat);
      if (mag > n) {
        flong *= n / mag;
        flat *= n / mag;
      }
      s.omega += (h * (torqueNm - flong * s.radiusM)) / s.inertia;
      fx += flong;
      fy += flat;
      mz += s.px * flat - s.py * flong;
    });
    robot.casters.forEach((c, i) => {
      const px = c.xM - robot.cogM.x;
      const py = c.yM - robot.cogM.y;
      const vpx = this.u - this.r * py;
      const vpy = this.w + this.r * px;
      const speed = Math.hypot(vpx, vpy);
      if (speed < 1e-9) return;
      const f =
        (c.coefficient * (robot.casterLoadN[i] ?? 0) * Math.tanh(speed / CASTER_SLIP_MPS)) / speed;
      fx -= f * vpx;
      fy -= f * vpy;
      mz += px * -f * vpy - py * -f * vpx;
    });
    const m = robot.massKg;
    this.u += h * (fx / m + this.r * this.w);
    this.w += h * (fy / m - this.r * this.u);
    this.r += (h * mz) / robot.yawInertiaKgM2;
    this.theta += h * this.r;
    const ct = Math.cos(this.theta);
    const st = Math.sin(this.theta);
    this.X += h * (this.u * ct - this.w * st);
    this.Y += h * (this.u * st + this.w * ct);
    this.batteryCurrentA = ibat;
    this.battery.draw(ibat, h);
    if (ibat > 0) this.energyJ += vbat * ibat * h;
  }

  private observe(): void {
    const p = this.pose();
    const ct = Math.cos(p.headingRad);
    const st = Math.sin(p.headingRad);
    const sx = p.x + this.arrayCentre.x * ct - this.arrayCentre.y * st;
    const sy = p.y + this.arrayCentre.x * st + this.arrayCentre.y * ct;
    // Windowed trackers keep this cheap and stop the error jumping to a crossing branch.
    const atSensors = this.sensorTracker.update(sx, sy);
    const prog = this.tracker.update(p.x, p.y);
    this.lateralMm = clamp(atSensors.lateral ?? this.lateralMm, -300, 300);
    const L = this.field.path.length;
    this.progressMm = this.closed ? prog.total : prog.s;

    const abs = Math.abs(this.lateralMm);
    this.sumAbsLat += abs;
    this.maxAbsLat = Math.max(this.maxAbsLat, abs);
    this.latSamples++;
    const sign = this.lateralMm > 1 ? 1 : this.lateralMm < -1 ? -1 : 0;
    if (sign !== 0) {
      if (this.latSign !== 0 && sign !== this.latSign) this.crossings++;
      this.latSign = sign;
    }

    if (this.closed && prog.laps > this.lapsDone) {
      this.lapsDone = prog.laps;
      this.events.push({
        tMs: this.tMs,
        type: "lap_complete",
        severity: "info",
        data: { lap: prog.laps },
      });
      if (this.lapsDone >= this.config.laps) {
        this.lapTimeMs = this.tMs;
        this.finish("finished");
        return;
      }
    }
    if (!this.closed && prog.s >= L - 15) {
      this.lapTimeMs = this.tMs;
      this.finish("finished");
      return;
    }

    const limit = this.config.offTrackMm;
    // Far from the followed path: confirm with a global search (the robot may have taken another
    // branch at a junction, which is still on the line).
    const off =
      atSensors.distance > limit &&
      prog.distance > limit &&
      this.field.closest(sx, sy, limit) === undefined &&
      this.field.closest(p.x, p.y, limit) === undefined;
    if (off) {
      this.offSinceMs ??= this.tMs;
      if (this.tMs - this.offSinceMs >= this.config.offTrackForMs) {
        this.events.push({
          tMs: this.offSinceMs,
          type: "off_track",
          severity: "error",
          data: {
            distanceMm: Math.round(Math.min(prog.distance, 999)),
            progressMm: Math.round(this.progressMm),
          },
        });
        this.finish("off_track");
        return;
      }
    } else this.offSinceMs = undefined;

    if (this.progressMm > this.bestProgress + 30) {
      this.bestProgress = this.progressMm;
      this.bestProgressAtMs = this.tMs;
    } else if (this.tMs - this.bestProgressAtMs > this.config.stuckForMs) {
      this.events.push({
        tMs: this.bestProgressAtMs,
        type: "stuck",
        severity: "error",
        data: { progressMm: Math.round(this.progressMm) },
      });
      this.finish("stuck");
    }
  }

  private record(): void {
    const need = (this.count + 1) * this.stride;
    if (need > this.data.length) {
      const bigger = new Float64Array(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    const p = this.pose();
    const o = this.count * this.stride;
    const d = this.data;
    const [wl, wr] = this.wheels;
    d[o] = this.tMs;
    d[o + 1] = p.x;
    d[o + 2] = p.y;
    d[o + 3] = p.headingRad;
    d[o + 4] = this.u * 1000;
    d[o + 5] = this.r;
    d[o + 6] = this.duty.left;
    d[o + 7] = this.duty.right;
    d[o + 8] = this.batteryV;
    d[o + 9] = this.logicV;
    d[o + 10] = this.lateralMm;
    d[o + 11] = this.progressMm;
    d[o + 12] = wl.currentA;
    d[o + 13] = wr.currentA;
    d[o + 14] = wl.omega;
    d[o + 15] = wr.omega;
    this.lastReadings.forEach((v, i) => (d[o + TRACE_CHANNELS.length + i] = v));
    this.count++;
  }

  private finish(outcome: Outcome): void {
    if (this.outcome) return;
    this.outcome = outcome;
    if (this.tMs % this.config.recordEveryMs !== 0) this.record();
  }

  /** Run to completion. */
  run(): SimResult {
    if (this.count === 0) this.record();
    while (!this.done) this.step();
    return this.result();
  }

  result(): SimResult {
    const L = this.field.path.length;
    const target = this.closed ? L * this.config.laps : L;
    const trace: PackedTrace = {
      stride: this.stride,
      count: this.count,
      sensorCount: this.robot.sensors.length,
      data: this.data.slice(0, this.count * this.stride),
    };
    const outcome = this.outcome ?? "timeout";
    const metrics: RunMetrics = {
      completionPct:
        outcome === "finished"
          ? 100
          : clamp((Math.max(this.bestProgress, this.progressMm) / target) * 100, 0, 100),
      ...(this.lapTimeMs !== undefined ? { lapTimeMs: this.lapTimeMs } : {}),
      meanLateralErrorMm: this.latSamples > 0 ? this.sumAbsLat / this.latSamples : 0,
      maxLateralErrorMm: this.maxAbsLat,
      ...(this.controller.loopPeriodMs
        ? { loopFrequencyHz: 1000 / this.controller.loopPeriodMs }
        : {}),
      energyJ: this.energyJ,
      oscillationIndex: this.tMs > 0 ? this.crossings / 2 / (this.tMs / 1000) : 0,
    };
    return {
      outcome,
      metrics,
      events: this.events,
      trace,
      hash: hashFloat64(trace.data, ["finished", "off_track", "stuck", "timeout"].indexOf(outcome)),
      durationMs: this.tMs,
      notes: this.robot.notes,
    };
  }
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Read one channel of a packed trace. */
export function column(trace: PackedTrace, channel: TraceChannel | number): Float64Array {
  const idx = typeof channel === "number" ? TRACE_CHANNELS.length + channel : channelIndex(channel);
  const out = new Float64Array(trace.count);
  for (let i = 0; i < trace.count; i++) out[i] = trace.data[i * trace.stride + idx] ?? 0;
  return out;
}
