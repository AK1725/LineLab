import { z } from "zod";
import { Pose } from "./primitives.js";

/** One telemetry sample from a real robot (LineLabTelemetry), as stored in a recording. */
export const TelemetrySampleRecord = z
  .object({
    /** Robot clock (micros() / 1000), ms. Unwrapped across the 32-bit micros() overflow. */
    tMs: z.number(),
    /** Raw sensor readings (ADC counts), in array order. */
    sensors: z.array(z.number().int().nonnegative()),
    /** Signed motor commands, −1..1. */
    pwmLeft: z.number().min(-1).max(1),
    pwmRight: z.number().min(-1).max(1),
    batteryV: z.number().nonnegative().optional(),
    lineLost: z.boolean(),
    encoders: z.tuple([z.number().int(), z.number().int()]).optional(),
    vars: z.array(z.number()),
  })
  .strict();
export type TelemetrySampleRecord = z.infer<typeof TelemetrySampleRecord>;

/** A recorded telemetry session: what the Robot tab saves and twin calibration reads. */
export const TelemetryRecording = z
  .object({
    format: z.literal("linelab-telemetry/1"),
    /** Sketch name from the hello frame (or "unknown" if none arrived). */
    name: z.string(),
    /** Where the data came from: a real robot, or a synthetic/simulated source (labelled). */
    source: z.enum(["real", "synthetic", "simulated"]),
    sensorCount: z.number().int().nonnegative(),
    periodMs: z.number().positive(),
    /** Optional: the track the run was on and where the robot started, for replay calibration. */
    trackId: z.string().optional(),
    startPose: Pose.optional(),
    /** Optional free-text notes / lines received as text frames. */
    notes: z.array(z.string()),
    samples: z.array(TelemetrySampleRecord),
  })
  .strict();
export type TelemetryRecording = z.infer<typeof TelemetryRecording>;
