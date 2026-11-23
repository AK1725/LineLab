import { z } from "zod";

export const FindingSeverity = z.enum(["error", "warning", "tip"]);
export type FindingSeverity = z.infer<typeof FindingSeverity>;

export const FindingRef = z
  .object({
    kind: z.enum(["placement", "pin", "net", "chassis", "firmware"]),
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
    /**
     * One-click fix. `operations` gets a typed DesignOperation union in Phase 3 (rules engine);
     * until then it is opaque and the UI does not offer fixes.
     */
    fix: z
      .object({
        label: z.string().min(1),
        operations: z.array(z.unknown()).min(1),
      })
      .strict()
      .optional(),
  })
  .strict();
export type Finding = z.infer<typeof Finding>;
