import { z } from "zod";
import { DottedId, PositiveNumber, Polygon, Vec2, NonNegativeNumber } from "./primitives.js";

export const ChassisMaterial = z.enum([
  "acrylic",
  "fr4",
  "pla",
  "petg",
  "carbon_fiber",
  "aluminium",
  "plywood",
]);
export type ChassisMaterial = z.infer<typeof ChassisMaterial>;

export const Deck = z
  .object({
    index: z.number().int().nonnegative(),
    /** Height of the deck's top surface above the ground (mm). */
    heightMm: NonNegativeNumber,
    /** Defaults to the chassis outline when omitted. */
    outline: Polygon.optional(),
  })
  .strict();
export type Deck = z.infer<typeof Deck>;

export const WheelMount = z
  .object({
    side: z.enum(["left", "right"]),
    /** Wheel contact centre in chassis coordinates (mm). +x forward, +y left. */
    position: Vec2,
    axleHeightMm: PositiveNumber,
  })
  .strict();
export type WheelMount = z.infer<typeof WheelMount>;

export const Chassis = z
  .object({
    $schema: z.string().optional(),
    id: DottedId,
    name: z.string().min(1),
    /**
     * Free-text design lineage, e.g. "PCB-as-chassis racers common in sprint competitions".
     * Describe an archetype — never claim to replicate a specific team's robot.
     */
    inspiredBy: z.string().optional(),
    outline: Polygon,
    cutouts: z.array(Polygon).optional(),
    thicknessMm: PositiveNumber,
    material: ChassisMaterial,
    densityGcm3: PositiveNumber,
    decks: z.array(Deck).min(1),
    mountPoints: z.array(Vec2),
    /** Diameter of the holes at `mountPoints` (default M3 clearance, 3.2 mm). */
    mountHoleDiameterMm: PositiveNumber.optional(),
    wheelMounts: z.array(WheelMount).min(2),
    casterMounts: z.array(Vec2),
  })
  .strict()
  .superRefine((c, ctx) => {
    const sides = new Set(c.wheelMounts.map((w) => w.side));
    if (!sides.has("left") || !sides.has("right")) {
      ctx.addIssue({
        code: "custom",
        path: ["wheelMounts"],
        message: "A differential-drive chassis needs at least one left and one right wheel mount.",
      });
    }
    const deckIdx = new Set<number>();
    c.decks.forEach((d, i) => {
      if (deckIdx.has(d.index)) {
        ctx.addIssue({
          code: "custom",
          path: ["decks", i, "index"],
          message: "Duplicate deck index.",
        });
      }
      deckIdx.add(d.index);
    });
  });
export type Chassis = z.infer<typeof Chassis>;
