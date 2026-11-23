import { z } from "zod";
import { DottedId, HexColor, NonNegativeNumber, Pose, PositiveNumber, Vec2 } from "./primitives.js";

const unit = () => z.number().min(0).max(1);

export const TrackSurface = z
  .object({
    lineColor: HexColor,
    backgroundColor: HexColor,
    /** Fraction of IR light reflected (0 = black, 1 = ideal white). */
    lineReflectance: unit(),
    backgroundReflectance: unit(),
  })
  .strict()
  .refine((s) => Math.abs(s.lineReflectance - s.backgroundReflectance) >= 0.05, {
    error:
      "Line and background reflectance must differ by at least 0.05 or no sensor can see the line.",
  });
export type TrackSurface = z.infer<typeof TrackSurface>;

export const LineSegment = z.object({ type: z.literal("line"), from: Vec2, to: Vec2 }).strict();
export const ArcSegment = z
  .object({
    type: z.literal("arc"),
    center: Vec2,
    radiusMm: PositiveNumber,
    startAngleRad: z.number(),
    /** Positive = counter-clockwise. Non-zero, at most one full turn. */
    sweepRad: z
      .number()
      .refine(
        (v) => v !== 0 && Math.abs(v) <= 2 * Math.PI,
        "sweepRad must be non-zero and |sweep| <= 2π.",
      ),
  })
  .strict();
export const BezierSegment = z
  .object({ type: z.literal("bezier"), p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2 })
  .strict();

export const TrackSegment = z.discriminatedUnion("type", [LineSegment, ArcSegment, BezierSegment]);
export type TrackSegment = z.infer<typeof TrackSegment>;

/** Positions along the path are arc-length `s` in mm from the start. */
const ArcLengthSpan = { startS: NonNegativeNumber, endS: NonNegativeNumber };

export const TrackFeature = z.discriminatedUnion("type", [
  z.object({ type: z.literal("crossing"), position: Vec2 }).strict(),
  z.object({ type: z.literal("gap"), ...ArcLengthSpan }).strict(),
  z.object({ type: z.literal("inversion"), ...ArcLengthSpan }).strict(),
  z
    .object({
      type: z.literal("checkpoint"),
      position: Vec2,
      index: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({ type: z.literal("junction"), position: Vec2, branches: z.number().int().min(3) })
    .strict(),
]);
export type TrackFeature = z.infer<typeof TrackFeature>;

export const Track = z
  .object({
    $schema: z.string().optional(),
    id: DottedId,
    name: z.string().min(1),
    description: z.string().optional(),
    difficulty: z.enum(["easy", "medium", "hard", "expert"]).optional(),
    units: z.literal("mm"),
    surface: TrackSurface,
    lineWidthMm: PositiveNumber,
    segments: z.array(TrackSegment).min(1),
    features: z.array(TrackFeature),
    start: Pose,
    finish: Pose.optional(),
  })
  .strict()
  .superRefine((t, ctx) => {
    t.features.forEach((f, i) => {
      if ((f.type === "gap" || f.type === "inversion") && f.endS <= f.startS) {
        ctx.addIssue({
          code: "custom",
          path: ["features", i],
          message: `${f.type} endS must be greater than startS.`,
        });
      }
    });
  });
export type Track = z.infer<typeof Track>;
