import { z } from "zod";
import { Board } from "./board.js";
import { DottedId, NonNegativeNumber, PositiveNumber, Range, Vec2 } from "./primitives.js";

export const Category = z.enum([
  "mcu",
  "line_sensor",
  "sensor",
  "motor_driver",
  "motor",
  "wheel",
  "caster",
  "battery",
  "regulator",
  "communication",
  "display",
  "input",
  "indicator",
  "fan",
  "esc",
  "mechanical",
  "misc",
]);
export type Category = z.infer<typeof Category>;

export const PinFunction = z.enum([
  "power_in",
  "power_out",
  "gnd",
  "digital",
  "analog",
  "pwm",
  "i2c_sda",
  "i2c_scl",
  "spi_mosi",
  "spi_miso",
  "spi_sck",
  "spi_cs",
  "uart_tx",
  "uart_rx",
  "motor_out",
  "enable",
  "reset",
  "nc",
]);
export type PinFunction = z.infer<typeof PinFunction>;

export const Pin = z
  .object({
    id: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[A-Za-z0-9_+.-]+$/, "Pin ids use letters, digits, `_`, `+`, `.` or `-`."),
    label: z.string().min(1),
    /** Every function this pin can serve (e.g. Uno D9 = digital + pwm). */
    functions: z.array(PinFunction).min(1),
    /** Name the firmware uses for this pin, e.g. 9 or "A0". Lets Phase 3 check code against wiring. */
    arduinoPin: z.union([z.number().int().nonnegative(), z.string().min(1)]).optional(),
    /** ADC peripheral number, where the MCU has several (ESP32 ADC2 is unusable while WiFi runs). */
    adcUnit: z.number().int().min(0).max(3).optional(),
    adcChannel: z.number().int().nonnegative().optional(),
    /** Pin can only read, never drive (e.g. ESP32 GPIO34–39). */
    inputOnly: z.boolean().optional(),
    voltageDomainV: PositiveNumber.optional(),
    maxCurrentmA: PositiveNumber.optional(),
    fiveVoltTolerant: z.boolean().optional(),
    notes: z.string().optional(),
  })
  .strict();
export type Pin = z.infer<typeof Pin>;

const McuSpec = z
  .object({
    kind: z.literal("mcu"),
    arch: z.enum([
      "avr",
      "megaavr",
      "rp2040",
      "esp32",
      "esp32s3",
      "esp32c3",
      "stm32f1",
      "stm32f4",
      "samd21",
      "imxrt1062",
    ]),
    logicVoltageV: PositiveNumber,
    inputVoltage: Range,
    clockMHz: PositiveNumber,
    flashKB: PositiveNumber,
    sramKB: PositiveNumber,
    adcBits: z.number().int().min(8).max(16),
    /** True only if every GPIO tolerates 5 V. Per-pin exceptions go on `Pin.fiveVoltTolerant`. */
    fiveVoltTolerantIO: z.boolean(),
    /** Board id used to compile firmware for this MCU board. */
    fqbn: Board.optional(),
  })
  .strict();

const LineSensorSpec = z
  .object({
    kind: z.literal("line_sensor"),
    supplyVoltage: Range,
    outputType: z.enum(["analog", "digital", "rc"]),
    channels: z.number().int().positive(),
    channelPitchMm: NonNegativeNumber,
    optimalHeightMm: Range,
    maxCurrentmA: PositiveNumber,
  })
  .strict();

const MotorDriverSpec = z
  .object({
    kind: z.literal("motor_driver"),
    channels: z.number().int().positive(),
    logicVoltage: Range,
    motorVoltage: Range,
    continuousCurrentPerChannelA: PositiveNumber,
    peakCurrentPerChannelA: PositiveNumber,
    /** Typical total voltage lost across the bridge at rated current. */
    voltageDropV: NonNegativeNumber,
    maxPwmFrequencyKHz: PositiveNumber.optional(),
  })
  .strict();

const MotorSpec = z
  .object({
    kind: z.literal("motor"),
    ratedVoltageV: PositiveNumber,
    noLoadRpm: PositiveNumber,
    noLoadCurrentA: NonNegativeNumber,
    stallCurrentA: PositiveNumber,
    stallTorqueKgCm: PositiveNumber,
    gearRatio: PositiveNumber,
  })
  .strict();

const BatterySpec = z
  .object({
    kind: z.literal("battery"),
    chemistry: z.enum(["lipo", "li-ion", "lifepo4", "nimh", "alkaline"]),
    cellsInSeries: z.number().int().positive(),
    nominalVoltageV: PositiveNumber,
    fullVoltageV: PositiveNumber,
    cutoffVoltageV: PositiveNumber,
    capacitymAh: PositiveNumber,
    maxContinuousDischargeA: PositiveNumber,
    internalResistanceMilliohm: PositiveNumber,
  })
  .strict()
  .refine((b) => b.cutoffVoltageV < b.nominalVoltageV && b.nominalVoltageV <= b.fullVoltageV, {
    error: "Expected cutoffVoltageV < nominalVoltageV <= fullVoltageV.",
  });

const RegulatorSpec = z
  .object({
    kind: z.literal("regulator"),
    topology: z.enum(["linear", "buck", "boost", "buck-boost"]),
    inputVoltage: Range,
    /** Fixed regulators use min === max. */
    outputVoltage: Range,
    maxOutputCurrentA: PositiveNumber,
    dropoutV: NonNegativeNumber.optional(),
    efficiencyPct: z.number().min(1).max(100).optional(),
  })
  .strict();

const WheelSpec = z
  .object({
    kind: z.literal("wheel"),
    diameterMm: PositiveNumber,
    widthMm: PositiveNumber,
    /** Nominal tyre-to-track friction coefficient; sim-core randomises around it. */
    frictionCoefficient: PositiveNumber.optional(),
  })
  .strict();

const GenericSpec = z
  .object({
    kind: z.literal("generic"),
    supplyVoltage: Range.optional(),
    maxCurrentmA: PositiveNumber.optional(),
  })
  .strict();

export const ElectricalSpec = z.discriminatedUnion("kind", [
  McuSpec,
  LineSensorSpec,
  MotorDriverSpec,
  MotorSpec,
  BatterySpec,
  RegulatorSpec,
  WheelSpec,
  GenericSpec,
]);
export type ElectricalSpec = z.infer<typeof ElectricalSpec>;
export type ElectricalSpecKind = ElectricalSpec["kind"];

/** Which spec kinds are valid for each category. */
export const ALLOWED_SPEC_KINDS: Record<Category, readonly ElectricalSpecKind[]> = {
  mcu: ["mcu"],
  line_sensor: ["line_sensor"],
  sensor: ["generic"],
  motor_driver: ["motor_driver"],
  motor: ["motor"],
  wheel: ["wheel"],
  caster: ["generic"],
  battery: ["battery"],
  regulator: ["regulator"],
  communication: ["generic"],
  display: ["generic"],
  input: ["generic"],
  indicator: ["generic"],
  fan: ["generic", "motor"],
  esc: ["generic"],
  mechanical: ["generic"],
  misc: ["generic"],
};

export const ComponentModel = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("procedural"),
      generator: z.string().min(1),
      params: z.record(z.string(), z.number()),
    })
    .strict(),
  z
    .object({
      kind: z.literal("gltf"),
      url: z.url(),
      license: z.string().min(1),
      attribution: z.string().min(1),
    })
    .strict(),
]);
export type ComponentModel = z.infer<typeof ComponentModel>;

/** Parameters for a sim-core behavioural model (IR response curve, motor constants, ...). */
export const SimModelRef = z
  .object({
    model: z.string().min(1),
    params: z.record(z.string(), z.number()),
  })
  .strict();
export type SimModelRef = z.infer<typeof SimModelRef>;

export const MountingHole = z.object({ x: z.number(), y: z.number(), d: PositiveNumber }).strict();

export const Component = z
  .object({
    $schema: z.string().optional(),
    id: DottedId,
    name: z.string().min(1),
    aliases: z.array(z.string().min(1)),
    category: Category,
    manufacturer: z.string().min(1).optional(),
    datasheetUrl: z.url().optional(),
    typicalPriceUsd: NonNegativeNumber.optional(),
    dimensionsMm: z.object({ x: PositiveNumber, y: PositiveNumber, z: PositiveNumber }).strict(),
    massG: PositiveNumber,
    mountingHoles: z.array(MountingHole).optional(),
    /** Pin-1 / origin offset of the footprint, if not the bounding-box centre. */
    originMm: Vec2.optional(),
    model: ComponentModel,
    pins: z.array(Pin),
    electrical: ElectricalSpec,
    simModel: SimModelRef.optional(),
    /**
     * `needs-review` until a contributor has checked every value against the cited datasheet.
     * The UI shows a badge for unreviewed entries.
     */
    specStatus: z.enum(["needs-review", "reviewed"]),
    /** Caveats, e.g. "Generic clone; values vary by seller." */
    notes: z.string().min(1).optional(),
    license: z.literal("CC-BY-SA-4.0"),
    sources: z.array(z.url()).min(1, "Cite at least one source (datasheet or product page)."),
  })
  .strict()
  .superRefine((c, ctx) => {
    const seen = new Set<string>();
    c.pins.forEach((pin, i) => {
      if (seen.has(pin.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["pins", i, "id"],
          message: `Duplicate pin id "${pin.id}".`,
        });
      }
      seen.add(pin.id);
    });

    c.pins.forEach((pin, i) => {
      if (
        (pin.adcUnit !== undefined || pin.adcChannel !== undefined) &&
        !pin.functions.includes("analog")
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["pins", i],
          message: `Pin "${pin.id}" has an ADC unit/channel but no "analog" function.`,
        });
      }
      if (
        pin.inputOnly === true &&
        pin.functions.some((f) => f === "pwm" || f === "uart_tx" || f === "power_out")
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["pins", i],
          message: `Input-only pin "${pin.id}" cannot have an output function.`,
        });
      }
    });

    const allowed = ALLOWED_SPEC_KINDS[c.category];
    if (!allowed.includes(c.electrical.kind)) {
      ctx.addIssue({
        code: "custom",
        path: ["electrical", "kind"],
        message: `Category "${c.category}" expects electrical.kind in [${allowed.join(", ")}], got "${c.electrical.kind}".`,
      });
    }
  });
export type Component = z.infer<typeof Component>;
