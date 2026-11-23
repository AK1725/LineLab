import { z } from "zod";
import { Board } from "./board.js";
import { Chassis } from "./chassis.js";
import { DottedId, Ident, Quat, Vec3, PositiveNumber, NonNegativeNumber } from "./primitives.js";

export const Placement = z
  .object({
    instanceId: Ident,
    componentId: DottedId,
    /** Position of the component origin in chassis coordinates (mm). */
    position: Vec3,
    rotation: Quat,
    deck: z.number().int().nonnegative(),
  })
  .strict();
export type Placement = z.infer<typeof Placement>;

export const NetEndpoint = z.object({ instanceId: Ident, pinId: z.string().min(1) }).strict();
export type NetEndpoint = z.infer<typeof NetEndpoint>;

export const Net = z
  .object({
    id: Ident,
    name: z.string().min(1),
    connections: z.array(NetEndpoint).min(1),
  })
  .strict();
export type Net = z.infer<typeof Net>;

export const FirmwareRef = z
  .object({
    fileId: Ident,
    board: Board,
    language: z.enum(["arduino-cpp", "micropython"]),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  })
  .strict();
export type FirmwareRef = z.infer<typeof FirmwareRef>;

/** Digital-twin parameters fitted from real-robot data (Phase 9). All optional: defaults come from the DB. */
export const TwinParams = z
  .object({
    frictionMu: PositiveNumber.optional(),
    motorKtScaleLeft: PositiveNumber.optional(),
    motorKtScaleRight: PositiveNumber.optional(),
    driverDropV: NonNegativeNumber.optional(),
    sensorGain: PositiveNumber.optional(),
    sensorOffset: z.number().optional(),
    sensorNoiseStd: NonNegativeNumber.optional(),
    latencyMs: NonNegativeNumber.optional(),
    calibratedAt: z.iso.datetime().optional(),
  })
  .strict();
export type TwinParams = z.infer<typeof TwinParams>;

export const DesignChassis = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("template"), chassisId: DottedId }).strict(),
  z.object({ kind: z.literal("custom"), chassis: Chassis }).strict(),
]);
export type DesignChassis = z.infer<typeof DesignChassis>;

export const Design = z
  .object({
    $schema: z.string().optional(),
    id: Ident,
    name: z.string().min(1),
    version: z.number().int().positive(),
    chassis: DesignChassis,
    placements: z.array(Placement),
    netlist: z.array(Net),
    firmware: FirmwareRef.optional(),
    calibration: TwinParams.optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    const instances = new Set<string>();
    d.placements.forEach((p, i) => {
      if (instances.has(p.instanceId)) {
        ctx.addIssue({
          code: "custom",
          path: ["placements", i, "instanceId"],
          message: `Duplicate instanceId "${p.instanceId}".`,
        });
      }
      instances.add(p.instanceId);
    });

    const netIds = new Set<string>();
    const endpointOwner = new Map<string, string>();
    d.netlist.forEach((net, n) => {
      if (netIds.has(net.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["netlist", n, "id"],
          message: `Duplicate net id "${net.id}".`,
        });
      }
      netIds.add(net.id);

      net.connections.forEach((ep, c) => {
        const path = ["netlist", n, "connections", c];
        if (!instances.has(ep.instanceId)) {
          ctx.addIssue({
            code: "custom",
            path,
            message: `Net "${net.id}" references unknown instance "${ep.instanceId}".`,
          });
        }
        // A pin can only belong to one net; two nets sharing a pin are really one net.
        const key = `${ep.instanceId}/${ep.pinId}`;
        const owner = endpointOwner.get(key);
        if (owner !== undefined) {
          ctx.addIssue({
            code: "custom",
            path,
            message:
              owner === net.id
                ? `Pin ${key} is listed twice in net "${net.id}".`
                : `Pin ${key} is in both net "${owner}" and net "${net.id}".`,
          });
        } else {
          endpointOwner.set(key, net.id);
        }
      });
    });
  });
export type Design = z.infer<typeof Design>;
