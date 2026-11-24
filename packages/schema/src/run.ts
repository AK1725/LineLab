import { z } from "zod";
import { DottedId, Ident, NonNegativeNumber, Pose, PositiveNumber } from "./primitives.js";

export const SimEventType = z.enum([
  "line_lost",
  "line_reacquired",
  "off_track",
  "oscillation",
  "stuck",
  "infinite_loop",
  "missed_turn",
  "pwm_saturation",
  "integrator_windup",
  "brownout",
  "wdt_reset",
  "blocking_delay",
  "control_loop_jitter",
  "checkpoint",
  "lap_complete",
  /** One wheel turns backwards for a long time while the robot makes no progress. */
  "wrong_direction",
  /** The robot steers away from the line (sensor order or steering sign reversed). */
  "steering_inverted",
]);
export type SimEventType = z.infer<typeof SimEventType>;

export const SourceLoc = z
  .object({
    file: z.string().min(1),
    line: z.number().int().positive(),
    fn: z.string().optional(),
    /** True when measured (program counter); false when the line was found by pattern. */
    exact: z.boolean().optional(),
  })
  .strict();
export type SourceLoc = z.infer<typeof SourceLoc>;

export const SimEvent = z
  .object({
    tMs: NonNegativeNumber,
    type: SimEventType,
    severity: z.enum(["error", "warning", "info"]),
    data: z.record(z.string(), z.unknown()),
    /** Plain-language explanation and what to try. */
    message: z.string().optional(),
    sourceLoc: SourceLoc.optional(),
  })
  .strict();
export type SimEvent = z.infer<typeof SimEvent>;

export const Frame = z
  .object({
    tMs: NonNegativeNumber,
    pose: Pose,
    /** Forward speed (mm/s) and yaw rate (rad/s). */
    velocity: z.object({ v: z.number(), omega: z.number() }).strict(),
    /** Raw sensor readings in ADC counts (or µs for RC sensors), in array order. */
    sensors: z.array(z.number()),
    /** Signed duty cycle in [-1, 1]. */
    pwm: z.object({ left: z.number().min(-1).max(1), right: z.number().min(-1).max(1) }).strict(),
    batteryV: NonNegativeNumber,
  })
  .strict();
export type Frame = z.infer<typeof Frame>;

export const RunMetrics = z
  .object({
    completionPct: z.number().min(0).max(100),
    lapTimeMs: PositiveNumber.optional(),
    meanLateralErrorMm: NonNegativeNumber,
    maxLateralErrorMm: NonNegativeNumber,
    loopFrequencyHz: PositiveNumber.optional(),
    energyJ: NonNegativeNumber.optional(),
    oscillationIndex: NonNegativeNumber.optional(),
    /** Fraction of Monte Carlo seeds that completed (only set on aggregated runs). */
    robustness: z.number().min(0).max(1).optional(),
  })
  .strict();
export type RunMetrics = z.infer<typeof RunMetrics>;

export const RunTrace = z
  .object({
    runId: Ident,
    seed: z.number().int().nonnegative(),
    designHash: z.string().min(1),
    firmwareHash: z.string().min(1).optional(),
    trackId: DottedId,
    dtMs: PositiveNumber,
    frames: z.array(Frame),
    events: z.array(SimEvent),
    metrics: RunMetrics,
  })
  .strict()
  .superRefine((r, ctx) => {
    for (let i = 1; i < r.frames.length; i++) {
      const prev = r.frames[i - 1];
      const cur = r.frames[i];
      if (prev !== undefined && cur !== undefined && cur.tMs < prev.tMs) {
        ctx.addIssue({
          code: "custom",
          path: ["frames", i, "tMs"],
          message: "Frames must be in non-decreasing time order.",
        });
        break;
      }
    }
  });
export type RunTrace = z.infer<typeof RunTrace>;
