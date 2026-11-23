import { z } from "zod";

/**
 * Units: geometry is in millimetres (mm), angles in radians, time in milliseconds,
 * everything else SI unless the field name says otherwise (e.g. `massG`, `capacitymAh`).
 * Zod 4 numbers already reject NaN and ±Infinity, so no `.finite()` is needed.
 */

export const Vec2 = z.object({ x: z.number(), y: z.number() }).strict();
export type Vec2 = z.infer<typeof Vec2>;

export const Vec3 = z.object({ x: z.number(), y: z.number(), z: z.number() }).strict();
export type Vec3 = z.infer<typeof Vec3>;

/** Unit quaternion. Accepts a small tolerance so values round-tripped through JSON still pass. */
export const Quat = z
  .object({ x: z.number(), y: z.number(), z: z.number(), w: z.number() })
  .strict()
  .refine((q) => Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) < 1e-3, {
    error: "Quaternion must be normalised (|q| = 1).",
  });
export type Quat = z.infer<typeof Quat>;

/** Closed polygon in the chassis/track plane (mm). The last point connects back to the first. */
export const Polygon = z.array(Vec2).min(3, "A polygon needs at least 3 points.");
export type Polygon = z.infer<typeof Polygon>;

/** Planar pose: position in mm, heading in radians (0 = +x, counter-clockwise positive). */
export const Pose = z.object({ x: z.number(), y: z.number(), headingRad: z.number() }).strict();
export type Pose = z.infer<typeof Pose>;

export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected a #RRGGBB colour.");
export type HexColor = z.infer<typeof HexColor>;

/** Lower-case dotted identifier, e.g. `driver.tb6612fng` or `chassis.starter-2wd`. */
export const DottedId = z
  .string()
  .regex(
    /^[a-z0-9]+(\.[a-z0-9][a-z0-9_-]*)+$/,
    "Expected a lower-case dotted id such as `driver.tb6612fng`.",
  );

/** Generic identifier for instances, nets, runs, etc. */
export const Ident = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/, "Use letters, digits, `_`, `.`, `:` or `-`.");

export const PositiveNumber = z.number().positive();
export const NonNegativeNumber = z.number().nonnegative();

/** Closed numeric range with min <= max. */
export const Range = z
  .object({ min: z.number(), max: z.number() })
  .strict()
  .refine((r) => r.min <= r.max, { error: "Range min must be <= max." });
export type Range = z.infer<typeof Range>;
