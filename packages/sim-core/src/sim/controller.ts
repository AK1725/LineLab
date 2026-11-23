import type { SensorOutput } from "../model/sensor.js";

/** What a controller sees each millisecond. Readings are in sensor order (channel 1 first). */
export interface ControllerInput {
  tMs: number;
  sensors: readonly number[];
  /** Full-scale value of a reading: ADC max, 1 for digital boards, timeout µs for RC boards. */
  sensorMax: number;
  sensorOutput: SensorOutput;
  /** Lateral offset of each channel from the array centre (mm, + = left). For the reference
   * controller; firmware only sees readings. */
  channelOffsetsMm: readonly number[];
}

/** Signed motor duty cycles in [-1, 1]. */
export interface MotorCommand {
  left: number;
  right: number;
}

/**
 * Anything that drives the robot: the built-in reference PID, and from Phase 6 the emulated MCU
 * running the user's firmware. `tick` is called once per simulated millisecond; it returns a new
 * command, or undefined to keep the last one (a controller runs at its own loop rate).
 */
export interface Controller {
  readonly name: string;
  /** Nominal control-loop period, for metrics (undefined if unknown). */
  readonly loopPeriodMs?: number;
  reset(): void;
  tick(input: ControllerInput): MotorCommand | undefined;
  /** Internal values worth plotting (error, integral, ...). */
  watch?(): Record<string, number>;
}

export interface ReferencePidOptions {
  /** Base duty on a straight line. */
  baseDuty: number;
  /** Duty per unit of normalised error (error is −1..1 across the array). */
  kp: number;
  /** Duty per (normalised error per second). */
  kd: number;
  ki: number;
  loopPeriodMs: number;
  /** Slow down in proportion to |error| (0 = never). */
  cornerSlowdown: number;
}

export const DEFAULT_PID: ReferencePidOptions = {
  baseDuty: 0.45,
  kp: 1.1,
  kd: 0.035,
  ki: 0,
  loopPeriodMs: 2,
  cornerSlowdown: 0.5,
};

/**
 * A plain line-following PID, the kind most LFR tutorials end with: a weighted line position from
 * min/max-calibrated readings, PD (+ optional I) steering on top of a base speed, slowing in
 * corners, and turning hard towards the side where the line was last seen when it's lost.
 * It is a reference to test robots and the simulator against, not a tuned racer.
 */
export class ReferencePid implements Controller {
  readonly name = "reference-pid";
  readonly loopPeriodMs: number;
  private readonly o: ReferencePidOptions;
  private lo = Infinity;
  private hi = -Infinity;
  private lastError = 0;
  private integral = 0;
  private lastT = -Infinity;
  private error = 0;
  private lost = false;

  constructor(opts: Partial<ReferencePidOptions> = {}) {
    this.o = { ...DEFAULT_PID, ...opts };
    this.loopPeriodMs = this.o.loopPeriodMs;
  }

  reset(): void {
    this.lo = Infinity;
    this.hi = -Infinity;
    this.lastError = 0;
    this.integral = 0;
    this.lastT = -Infinity;
    this.error = 0;
    this.lost = false;
  }

  tick(input: ControllerInput): MotorCommand | undefined {
    if (input.tMs - this.lastT < this.o.loopPeriodMs) return undefined;
    const dtS = Number.isFinite(this.lastT)
      ? (input.tMs - this.lastT) / 1000
      : this.o.loopPeriodMs / 1000;
    this.lastT = input.tMs;

    // Calibrate on the fly: one min/max for the whole array, as QTR-style libraries do.
    for (const v of input.sensors) {
      this.lo = Math.min(this.lo, v);
      this.hi = Math.max(this.hi, v);
    }
    const span = this.hi - this.lo;
    const minSpan = input.sensorOutput === "digital" ? 0.5 : input.sensorMax * 0.15;
    const offsets = input.channelOffsetsMm;
    const halfWidth = Math.max(1, ...offsets.map(Math.abs));
    let sum = 0;
    let weighted = 0;
    input.sensors.forEach((v, i) => {
      const dark = span >= minSpan ? Math.max(0, (v - this.lo) / span - 0.1) / 0.9 : 0;
      sum += dark;
      weighted += dark * (offsets[i] ?? 0);
    });
    this.lost = sum < 0.3;
    if (this.lost) this.error = this.lastError >= 0 ? 1 : -1;
    else this.error = weighted / sum / halfWidth;

    const d = (this.error - this.lastError) / dtS;
    this.integral = Math.max(-1, Math.min(1, this.integral + this.error * dtS));
    this.lastError = this.error;
    const turn = this.o.kp * this.error + this.o.kd * d + this.o.ki * this.integral;
    const base = this.lost
      ? 0.15
      : this.o.baseDuty * (1 - this.o.cornerSlowdown * Math.min(1, Math.abs(this.error)));
    const clamp = (x: number) => Math.max(-1, Math.min(1, x));
    // Positive error = line to the left: speed up the right wheel.
    return { left: clamp(base - turn), right: clamp(base + turn) };
  }

  watch(): Record<string, number> {
    return { error: this.error, integral: this.integral, lost: this.lost ? 1 : 0 };
  }
}

/** Fixed duties (open loop), for physics tests and motor checks. */
export class ConstantController implements Controller {
  readonly name = "constant";
  constructor(private readonly cmd: MotorCommand) {}
  reset(): void {}
  tick(): MotorCommand {
    return this.cmd;
  }
}
