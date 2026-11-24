import { z } from "zod";
import { Category } from "./component.js";
import { DottedId } from "./primitives.js";

/** Which side of the robot a photo shows. The top view sets scale and placement. */
export const PhotoView = z.enum(["top", "bottom", "front", "back", "left", "right", "other"]);
export type PhotoView = z.infer<typeof PhotoView>;

/** Axis-aligned box in a photo, as fractions of its width and height (0..1, origin top-left). */
export const PhotoBox = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(0).max(1),
    h: z.number().min(0).max(1),
  })
  .strict();
export type PhotoBox = z.infer<typeof PhotoBox>;

/** One part a detector found (possibly seen in several photos). */
export const PhotoDetection = z
  .object({
    id: z.string().min(1).max(40),
    category: Category,
    /** What it looks like, in the detector's words ("red TB6612FNG breakout, 6 pins per side"). */
    description: z.string().max(400),
    /** Text read off the part: chip markings, silkscreen, labels ("TB6612FNG", "QTR-8A"). */
    markings: z.array(z.string().max(60)).max(10),
    /** How many identical ones (two motors, two wheels). */
    count: z.number().int().min(1).max(8),
    /** Where it is in the top photo, if visible there. */
    topBox: PhotoBox.optional(),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type PhotoDetection = z.infer<typeof PhotoDetection>;

export const DetectionResult = z
  .object({
    /** Who produced it: the vision model, a trained detector, or a scripted replay (tests, demos). */
    detector: z.enum(["claude-vision", "yolo", "scripted"]),
    model: z.string().optional(),
    detections: z.array(PhotoDetection).max(40),
    /** Robot front direction in the top photo. The guided capture asks for "up". */
    frontInTop: z.enum(["up", "down", "left", "right"]).default("up"),
    notes: z.array(z.string().max(400)).max(10).default([]),
  })
  .strict();
export type DetectionResult = z.infer<typeof DetectionResult>;

/** A fixture photo set: photos plus what is really on the robot (for evals). */
export const PhotoSetTruth = z
  .object({
    id: z.string().min(1),
    /** "real" photos, or "render" (LineLab's own 3D view, for pipeline tests only). */
    kind: z.enum(["real", "render"]),
    photos: z.array(z.object({ file: z.string(), view: PhotoView }).strict()).min(1),
    /** Major components on the robot, by database id, with how many. */
    components: z.array(
      z.object({ componentId: DottedId, count: z.number().int().min(1) }).strict(),
    ),
    /** Outer size of the chassis (mm), if known. */
    chassisMm: z
      .object({ length: z.number().positive(), width: z.number().positive() })
      .strict()
      .optional(),
  })
  .strict();
export type PhotoSetTruth = z.infer<typeof PhotoSetTruth>;
