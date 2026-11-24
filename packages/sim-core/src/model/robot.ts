import { designMassProps, yawOf, type Lookup } from "@linelab/design-core";
import type { Chassis, Component, Design, Placement, TwinParams } from "@linelab/schema";
import { G_MPS2, motorParams, type MotorParams } from "./motor.js";
import type { SensorChannel } from "./sensor.js";

type Spec<K extends Component["electrical"]["kind"]> = Extract<
  Component["electrical"],
  { kind: K }
>;

/** Tyre friction on matte paper or vinyl when a wheel gives none (rubber: 0.8–1.0). */
export const DEFAULT_TYRE_MU = 0.9;
/** Sliding friction of a nylon/PTFE skid on paper. */
export const SKID_MU = 0.25;
/** Rolling resistance of a ball caster. */
export const BALL_CASTER_CRR = 0.04;
/** Fallback when a robot has no caster: the chassis edge drags on the floor. */
export const DRAG_EDGE_MU = 0.35;
/** MCU, LEDs and logic draw (A), besides the sensors' rated current. */
export const LOGIC_CURRENT_A = 0.05;

export interface WheelModel {
  side: "left" | "right";
  instanceId: string;
  motorInstanceId: string;
  /** Contact point, chassis frame (m). */
  xM: number;
  yM: number;
  radiusM: number;
  mu: number;
  motor: MotorParams;
  /** Rotor (reflected) plus wheel inertia about the axle. */
  inertiaKgM2: number;
}

export interface CasterModel {
  instanceId: string | undefined;
  xM: number;
  yM: number;
  kind: "skid" | "ball" | "edge";
  /** Sliding μ (skid/edge) or rolling resistance coefficient (ball). */
  coefficient: number;
}

export interface RobotModel {
  massKg: number;
  /** Centre of gravity in the chassis frame (m). */
  cogM: { x: number; y: number; z: number };
  yawInertiaKgM2: number;
  wheels: [WheelModel, WheelModel];
  casters: CasterModel[];
  /** Static normal loads (N): per wheel [left, right], and per caster. */
  wheelLoadN: [number, number];
  casterLoadN: number[];
  driver: { instanceId: string; dropV: number; continuousA: number; peakA: number };
  battery: { instanceId: string; spec: Spec<"battery"> };
  logic: {
    voltageV: number;
    dropoutV: number;
    brownoutV: number;
    adcBits: number;
    currentA: number;
  };
  sensors: SensorChannel[];
  /** Fitted sensor-path twin parameters (Phase 9); absent = the nominal sensor. */
  sensorTwin?: SensorTwin;
  /** Notes about approximations used for this design (shown with the run). */
  notes: string[];
}

export interface SensorTwin {
  /** Multiplies the reflected signal. */
  gain: number;
  /** Added to the normalised (dark = 1) reading. */
  offset: number;
  /** Replaces the run's sensor noise when set (fraction of full scale). */
  noiseStd: number | undefined;
  /** Extra sensor-to-controller latency (ms). */
  latencyMs: number;
}

/** The sensor part of fitted twin parameters, or undefined when none are set. */
export function sensorTwinOf(twin: TwinParams): SensorTwin | undefined {
  if (
    twin.sensorGain === undefined &&
    twin.sensorOffset === undefined &&
    twin.sensorNoiseStd === undefined &&
    twin.latencyMs === undefined
  )
    return undefined;
  return {
    gain: twin.sensorGain ?? 1,
    offset: twin.sensorOffset ?? 0,
    noiseStd: twin.sensorNoiseStd,
    latencyMs: twin.latencyMs ?? 0,
  };
}

export class SimSetupError extends Error {
  constructor(readonly issues: string[]) {
    super(`This design can't be simulated yet: ${issues.join(" ")}`);
    this.name = "SimSetupError";
  }
}

interface Part {
  p: Placement;
  c: Component;
}

/** Turn a design into the physical model the simulator integrates. Throws SimSetupError listing
 * what's missing (wheels, motors, driver, battery, line sensor). */
export function buildRobotModel(
  design: Design,
  chassis: Chassis,
  lookup: Lookup,
  twin: TwinParams = design.calibration ?? {},
): RobotModel {
  const parts: Part[] = design.placements.flatMap((p) => {
    const c = lookup(p.componentId);
    return c ? [{ p, c }] : [];
  });
  const of = (cat: Component["category"]) => parts.filter((x) => x.c.category === cat);
  const issues: string[] = [];
  const notes: string[] = [];

  const wheels = of("wheel");
  const motors = of("motor");
  const side = (xs: Part[], s: "left" | "right") =>
    xs
      .filter((x) => (s === "left" ? x.p.position.y > 0 : x.p.position.y < 0))
      .sort((a, b) => Math.abs(a.p.position.x) - Math.abs(b.p.position.x))[0];
  const wl = side(wheels, "left");
  const wr = side(wheels, "right");
  const ml = side(motors, "left");
  const mr = side(motors, "right");
  if (!wl || !wr) issues.push("Add a wheel on each side.");
  if (!ml || !mr) issues.push("Add a drive motor on each side.");
  if (wheels.length > 2 || motors.length > 2)
    notes.push("Only the two drive wheels nearest the axle are simulated (differential drive).");
  const driverPart = of("motor_driver")[0];
  if (!driverPart) issues.push("Add a motor driver.");
  const batteryPart = of("battery")[0];
  if (!batteryPart) issues.push("Add a battery.");
  const sensorParts = of("line_sensor");
  if (sensorParts.length === 0) issues.push("Add a line sensor.");
  if (issues.length > 0 || !wl || !wr || !ml || !mr || !driverPart || !batteryPart)
    throw new SimSetupError(issues);
  if (ml.c.electrical.kind !== "motor" || mr.c.electrical.kind !== "motor")
    throw new SimSetupError(["The drive motors have no motor data."]);
  if (driverPart.c.electrical.kind !== "motor_driver")
    throw new SimSetupError(["The motor driver has no electrical data."]);
  if (batteryPart.c.electrical.kind !== "battery")
    throw new SimSetupError(["The battery has no electrical data."]);
  const driverSpec = driverPart.c.electrical;
  const batterySpec = batteryPart.c.electrical;

  // Mass, CoG and yaw inertia.
  const mass = designMassProps(design, chassis, lookup);
  const massKg = mass.massG / 1000;
  const cog = { x: mass.cog.x / 1000, y: mass.cog.y / 1000, z: mass.cog.z / 1000 };
  let iz = 0;
  for (const { p, c } of parts) {
    const m = c.massG / 1000;
    const dx = p.position.x / 1000 - cog.x;
    const dy = p.position.y / 1000 - cog.y;
    const a = c.dimensionsMm.x / 1000;
    const b = c.dimensionsMm.y / 1000;
    iz += m * (dx * dx + dy * dy) + (m * (a * a + b * b)) / 12;
  }
  {
    const xs = chassis.outline.map((v) => v.x / 1000);
    const ys = chassis.outline.map((v) => v.y / 1000);
    const l = Math.max(...xs) - Math.min(...xs);
    const w = Math.max(...ys) - Math.min(...ys);
    const m = mass.chassis.massG / 1000;
    const dx = mass.chassis.cog.x / 1000 - cog.x;
    const dy = mass.chassis.cog.y / 1000 - cog.y;
    iz += m * (dx * dx + dy * dy) + (m * (l * l + w * w)) / 12;
  }

  // Wheels and motors.
  const mu = twin.frictionMu ?? DEFAULT_TYRE_MU;
  const wheel = (w: Part, m: Part, s: "left" | "right", ktScale: number): WheelModel => {
    const spec = w.c.electrical.kind === "wheel" ? w.c.electrical : undefined;
    const radiusM = (spec?.diameterMm ?? w.c.dimensionsMm.z) / 2000;
    const motor = motorParams(m.c.electrical as Spec<"motor">, ktScale);
    const wheelKg = w.c.massG / 1000;
    return {
      side: s,
      instanceId: w.p.instanceId,
      motorInstanceId: m.p.instanceId,
      xM: w.p.position.x / 1000,
      yM: w.p.position.y / 1000,
      radiusM,
      mu: twin.frictionMu ?? spec?.frictionCoefficient ?? mu,
      motor,
      inertiaKgM2: motor.inertiaKgM2 + 0.5 * wheelKg * radiusM * radiusM,
    };
  };
  const left = wheel(wl, ml, "left", twin.motorKtScaleLeft ?? 1);
  const right = wheel(wr, mr, "right", twin.motorKtScaleRight ?? 1);

  // Casters and the static load split between the axle and the casters.
  const casters: CasterModel[] = of("caster").map(({ p, c }) => {
    const skid = /skid|glide/i.test(`${c.id} ${c.name}`);
    return {
      instanceId: p.instanceId,
      xM: p.position.x / 1000,
      yM: p.position.y / 1000,
      kind: skid ? "skid" : "ball",
      coefficient: skid ? SKID_MU : BALL_CASTER_CRR,
    };
  });
  const axleX = (left.xM + right.xM) / 2;
  if (casters.length === 0) {
    const xs = chassis.outline.map((v) => v.x / 1000);
    const edge = cog.x >= axleX ? Math.max(...xs) : Math.min(...xs);
    casters.push({
      instanceId: undefined,
      xM: edge,
      yM: 0,
      kind: "edge",
      coefficient: DRAG_EDGE_MU,
    });
    notes.push("No caster: the chassis edge is assumed to drag on the floor.");
  }
  const weightN = massKg * G_MPS2;
  const cx = casters.reduce((s, c) => s + c.xM, 0) / casters.length;
  let casterShare = Math.abs(cx - axleX) > 1e-6 ? (cog.x - axleX) / (cx - axleX) : 0;
  if (casterShare < 0 || casterShare > 1) {
    notes.push(
      "The centre of gravity is outside the wheel–caster support: the robot would tip. Loads are clamped.",
    );
    casterShare = Math.max(0, Math.min(1, casterShare));
  }
  const casterLoadN = casters.map(() => (weightN * casterShare) / casters.length);
  // Split the axle's share between the wheels by the CoG's lateral position.
  const axleN = weightN * (1 - casterShare);
  const leftShare = Math.max(0, Math.min(1, (cog.y - right.yM) / (left.yM - right.yM)));
  const wheelLoadN: [number, number] = [axleN * leftShare, axleN * (1 - leftShare)];

  if (of("fan").length > 0)
    notes.push("Fan downforce is not simulated yet: the parts have no thrust data.");

  // Logic supply: a regulator if there is one, otherwise the MCU board's own regulator.
  const mcu = of("mcu")[0]?.c.electrical;
  const mcuSpec = mcu?.kind === "mcu" ? mcu : undefined;
  const logicV = mcuSpec?.logicVoltageV ?? 5;
  const reg = of("regulator")
    .map((x) => x.c.electrical)
    .find((e): e is Spec<"regulator"> => e.kind === "regulator" && e.topology !== "boost");
  const dropoutV = reg ? (reg.dropoutV ?? (reg.topology === "linear" ? 1.1 : 0.4)) : 1.1;
  if (!mcuSpec) notes.push("No microcontroller: assuming a 10-bit ADC at 5 V.");

  const sensors: SensorChannel[] = [];
  for (const { p, c } of sensorParts) {
    const e = c.electrical.kind === "line_sensor" ? c.electrical : undefined;
    const n = e?.channels ?? 1;
    const pitch = e?.channelPitchMm ?? 0;
    const yaw = yawOf(p.rotation);
    // Channels run along the board's longer horizontal side; channel 1 is on the robot's left
    // (+y) when the board isn't rotated.
    const along = c.dimensionsMm.y >= c.dimensionsMm.x ? { x: 0, y: 1 } : { x: 1, y: 0 };
    const ax = along.x * Math.cos(yaw) - along.y * Math.sin(yaw);
    const ay = along.x * Math.sin(yaw) + along.y * Math.cos(yaw);
    for (let i = 0; i < n; i++) {
      const off = ((n - 1) / 2 - i) * pitch;
      sensors.push({
        xMm: p.position.x + ax * off,
        yMm: p.position.y + ay * off,
        heightMm: p.position.z,
        optimalMaxMm: e?.optimalHeightMm.max ?? 6,
        output: e?.outputType ?? "analog",
        instanceId: p.instanceId,
        channel: i + 1,
      });
    }
  }
  const sensorCurrentA = sensorParts.reduce(
    (s, x) => s + (x.c.electrical.kind === "line_sensor" ? x.c.electrical.maxCurrentmA / 1000 : 0),
    0,
  );

  const sensorTwin = sensorTwinOf(twin);
  return {
    massKg,
    cogM: cog,
    yawInertiaKgM2: iz,
    wheels: [left, right],
    casters,
    wheelLoadN,
    casterLoadN,
    driver: {
      instanceId: driverPart.p.instanceId,
      dropV: twin.driverDropV ?? driverSpec.voltageDropV,
      continuousA: driverSpec.continuousCurrentPerChannelA,
      peakA: driverSpec.peakCurrentPerChannelA,
    },
    battery: { instanceId: batteryPart.p.instanceId, spec: batterySpec },
    logic: {
      voltageV: logicV,
      dropoutV,
      brownoutV: logicV * 0.85,
      adcBits: mcuSpec?.adcBits ?? 10,
      currentA: LOGIC_CURRENT_A + sensorCurrentA,
    },
    sensors,
    ...(sensorTwin ? { sensorTwin } : {}),
    notes,
  };
}
