import { z } from "zod";
import { DesignChassis, Net, NetEndpoint, Placement, TwinParams } from "./design.js";
import { Quat, Vec3, Ident, NonNegativeNumber } from "./primitives.js";

/** Fields of a placement that a command may change. */
export const PlacementPatch = z
  .object({
    position: Vec3.optional(),
    rotation: Quat.optional(),
    deck: z.number().int().nonnegative().optional(),
    mount: z.enum(["top", "bottom"]).optional(),
    standoffMm: NonNegativeNumber.optional(),
  })
  .strict();
export type PlacementPatch = z.infer<typeof PlacementPatch>;

/**
 * Every change to a design is one of these commands. They are plain data, so they can be logged,
 * replayed, undone, attached to a rules-engine finding as a one-click fix, or proposed by the AI agent.
 */
export const DesignCommand = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add"), placements: z.array(Placement).min(1) }).strict(),
  z.object({ type: z.literal("remove"), ids: z.array(Ident).min(1) }).strict(),
  z
    .object({
      type: z.literal("update"),
      changes: z.array(z.object({ id: Ident, patch: PlacementPatch }).strict()).min(1),
    })
    .strict(),
  z.object({ type: z.literal("set-chassis"), chassis: DesignChassis }).strict(),
  z.object({ type: z.literal("rename"), name: z.string().min(1) }).strict(),
  /** Joins two pins into one net (creating or merging nets as needed). */
  z.object({ type: z.literal("connect"), a: NetEndpoint, b: NetEndpoint }).strict(),
  /** Removes one pin from its net; nets left with fewer than two pins disappear. */
  z.object({ type: z.literal("disconnect"), endpoint: NetEndpoint }).strict(),
  z.object({ type: z.literal("rename-net"), id: Ident, name: z.string().min(1) }).strict(),
  /** Replaces the whole netlist (auto-wiring, imports). */
  z.object({ type: z.literal("set-netlist"), netlist: z.array(Net) }).strict(),
  /** Sets (or, with undefined, clears) the fitted digital-twin parameters. */
  z.object({ type: z.literal("set-calibration"), calibration: TwinParams.optional() }).strict(),
]);
export type DesignCommand = z.infer<typeof DesignCommand>;
