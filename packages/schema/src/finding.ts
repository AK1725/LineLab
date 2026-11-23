import { z } from "zod";
import { DesignCommand } from "./command.js";

export const FindingSeverity = z.enum(["error", "warning", "tip"]);
export type FindingSeverity = z.infer<typeof FindingSeverity>;

export const FindingRef = z
  .object({
    kind: z.enum(["placement", "pin", "net", "chassis", "firmware", "design"]),
    /** instanceId, `${instanceId}/${pinId}`, net id, chassis id or `file:line`. */
    ref: z.string().min(1),
  })
  .strict();
export type FindingRef = z.infer<typeof FindingRef>;

export const Finding = z
  .object({
    /** Stable rule id, e.g. `elec.missing-common-ground`. */
    id: z.string().regex(/^[a-z]+\.[a-z0-9-]+$/),
    severity: FindingSeverity,
    message: z.string().min(1),
    explanation: z.string().min(1),
    affected: z.array(FindingRef),
    /** One-click fix: design commands applied together as a single undo step. */
    fix: z
      .object({
        label: z.string().min(1),
        operations: z.array(DesignCommand).min(1),
      })
      .strict()
      .optional(),
  })
  .strict();
export type Finding = z.infer<typeof Finding>;
