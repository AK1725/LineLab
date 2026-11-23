import { Group } from "three";
import { z } from "zod";
import {
  COLORS,
  box,
  clamp,
  cylinder,
  headerStrip,
  material,
  paletteColor,
  sphere,
  type Dims,
} from "./kit.js";

const colorIndex = (fallback: number) => z.number().int().min(0).max(11).default(fallback);
const flag = (fallback: 0 | 1) => z.number().int().min(0).max(1).default(fallback);
const count = (fallback: number, max = 64) => z.number().int().min(0).max(max).default(fallback);
const mm = (fallback: number) => z.number().min(0).default(fallback);

interface GeneratorDef<S extends z.ZodObject> {
  name: string;
  description: string;
  params: S;
  build: (dims: Dims, params: z.output<S>) => Group;
}

export interface Generator {
  name: string;
  description: string;
  /** Parameter names this generator accepts (for docs and the contribution guide). */
  paramNames: string[];
  /** Validates raw params from the data file. Returns problems, or [] when valid. */
  check: (raw: Record<string, number>) => string[];
  build: (dims: Dims, raw: Record<string, number>) => Group;
}

function define<S extends z.ZodObject>(def: GeneratorDef<S>): Generator {
  const schema = def.params.strict();
  const parse = (raw: Record<string, number>) => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((i) => `${i.path.join(".") || "params"}: ${i.message}`)
        .join("; ");
      throw new Error(`${def.name}: invalid params (${details})`);
    }
    return parsed.data as z.output<S>;
  };
  return {
    name: def.name,
    description: def.description,
    paramNames: Object.keys(def.params.shape),
    check: (raw) => {
      try {
        parse(raw);
        return [];
      } catch (err) {
        return [(err as Error).message];
      }
    },
    build: (dims, raw) => {
      const group = def.build(dims, parse(raw));
      group.name = def.name;
      group.userData.generator = def.name;
      return group;
    },
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Circuit boards                                                                              */
/* ------------------------------------------------------------------------------------------ */

const pcbParams = z.object({
  pcbColor: colorIndex(4),
  thicknessMm: mm(1.6),
  /** Pin-header rows along the two long (±y) edges: 0, 1 (one edge) or 2. */
  headerRows: count(0, 2),
  /** Pins per header row; 0 = as many as fit. */
  headerPins: count(0),
  /** Square IC footprint size; 0 = none. */
  chipMm: mm(0),
  chipHeightMm: mm(1.2),
  /** 0 none, 1 micro-USB / USB-C, 2 USB-B (Uno-style). Placed on the -x edge. */
  usb: count(0, 2),
  barrelJack: flag(0),
  /** Blue 5.08 mm screw terminals along the +x edge. */
  screwTerminals: count(0, 8),
  /** Finned heatsink height (L298N-style); 0 = none. */
  heatsinkMm: mm(0),
  /** Power inductor diameter (buck/boost modules); 0 = none. */
  inductorMm: mm(0),
  /** Electrolytic capacitors. */
  capacitors: count(0, 6),
  potentiometer: flag(0),
  /** Display glass covering most of the top (OLED modules). */
  screen: flag(0),
  /** Ultrasonic transducer pair (HC-SR04). */
  transducers: flag(0),
  /** Antenna/module can at the +x end (ESP32 modules, radios). */
  rfModuleMm: mm(0),
});

function buildPcb(d: Dims, p: z.output<typeof pcbParams>): Group {
  const g = new Group();
  const t = clamp(p.thicknessMm, 0.4, d.z);
  const top = t;
  const room = d.z - t;
  box(
    g,
    { x: d.x, y: d.y, z: t },
    { cx: 0, cy: 0, z0: 0 },
    material(paletteColor(p.pcbColor)),
    "pcb",
  );

  if (p.headerRows > 0 && room > 0.5) {
    const pins = p.headerPins > 0 ? p.headerPins : Math.max(1, Math.floor((d.x - 2) / 2.54));
    const fit = Math.min(pins, Math.floor(d.x / 2.54));
    const edge = d.y / 2 - 1.6;
    const ys = p.headerRows === 2 ? [edge, -edge] : [edge];
    for (const cy of ys)
      headerStrip(g, { count: fit, rows: 1, cx: 0, cy, z0: top, maxHeight: room });
  }
  if (p.chipMm > 0 && room > 0) {
    const s = Math.min(p.chipMm, d.x * 0.8, d.y * 0.8);
    box(
      g,
      { x: s, y: s, z: Math.min(p.chipHeightMm, room) },
      { cx: 0, cy: 0, z0: top },
      material(COLORS.black, { rough: 0.4 }),
      "ic",
    );
  }
  if (p.usb > 0 && room > 0) {
    const size = p.usb === 2 ? { x: 16, y: 12, z: 11 } : { x: 5.5, y: 8, z: 3 };
    const sx = Math.min(size.x, d.x * 0.3);
    box(
      g,
      { x: sx, y: Math.min(size.y, d.y * 0.6), z: Math.min(size.z, room) },
      { cx: -d.x / 2 + sx / 2, cy: 0, z0: top },
      material(COLORS.silver, { metal: true }),
      "usb",
    );
  }
  if (p.barrelJack === 1 && room > 0) {
    const sx = Math.min(14, d.x * 0.25);
    box(
      g,
      { x: sx, y: Math.min(9, d.y * 0.3), z: Math.min(11, room) },
      { cx: -d.x / 2 + sx / 2, cy: -d.y / 4, z0: top },
      material(COLORS.black),
      "barrel-jack",
    );
  }
  if (p.screwTerminals > 0 && room > 0) {
    const pitch = 5.08;
    const n = Math.min(p.screwTerminals, Math.floor(d.y / pitch));
    const sx = Math.min(7.5, d.x * 0.25);
    box(
      g,
      { x: sx, y: n * pitch, z: Math.min(10, room) },
      { cx: d.x / 2 - sx / 2, cy: 0, z0: top },
      material(COLORS.blue),
      "screw-terminal",
    );
  }
  if (p.heatsinkMm > 0 && room > 0) {
    const h = Math.min(p.heatsinkMm, room);
    const w = d.x * 0.5;
    const fins = 7;
    const black = material(COLORS.black, { metal: true, rough: 0.5 });
    box(
      g,
      { x: w, y: d.y * 0.5, z: Math.min(2, h) },
      { cx: 0, cy: 0, z0: top },
      black,
      "heatsink-base",
    );
    for (let i = 0; i < fins; i++) {
      box(
        g,
        { x: 1, y: d.y * 0.5, z: h },
        { cx: -w / 2 + 0.5 + (i * (w - 1)) / (fins - 1), cy: 0, z0: top },
        black,
        "heatsink-fin",
      );
    }
  }
  if (p.inductorMm > 0 && room > 0) {
    const r = Math.min(p.inductorMm, d.x * 0.45, d.y * 0.8) / 2;
    const h = Math.min(r * 1.2, room);
    cylinder(
      g,
      { radius: r, length: h, axis: "z", center: { x: -d.x / 6, y: 0, z: top + h / 2 } },
      material(COLORS.black, { rough: 0.8 }),
      "inductor",
    );
  }
  if (p.capacitors > 0 && room > 0) {
    const r = Math.min(3, d.y / 6);
    const h = Math.min(8, room);
    for (let i = 0; i < p.capacitors; i++) {
      const cx = clamp(d.x / 4 + (i % 2) * 2 * r - r, -d.x / 2 + r, d.x / 2 - r);
      const cy = clamp((i < 2 ? 1 : -1) * (d.y / 2 - r - 0.5), -d.y / 2 + r, d.y / 2 - r);
      cylinder(
        g,
        { radius: r, length: h, axis: "z", center: { x: cx, y: cy, z: top + h / 2 } },
        material(COLORS.blue, { rough: 0.3 }),
        "capacitor",
      );
    }
  }
  if (p.potentiometer === 1 && room > 0) {
    const s = Math.min(9.5, d.x * 0.25, d.y * 0.4);
    box(
      g,
      { x: s, y: s * 0.45, z: Math.min(10, room) },
      { cx: d.x / 2 - s / 2 - 0.5, cy: d.y / 2 - s * 0.25 - 0.5, z0: top },
      material(COLORS.blue),
      "trimpot",
    );
  }
  if (p.screen === 1 && room > 0) {
    box(
      g,
      { x: d.x * 0.9, y: d.y * 0.7, z: Math.min(1.5, room) },
      { cx: 0, cy: -d.y * 0.08, z0: top },
      material(COLORS.black, { rough: 0.15 }),
      "screen",
    );
  }
  if (p.transducers === 1 && room > 0) {
    const r = Math.min(8, d.x / 4 - 0.5, d.y / 2);
    const h = Math.min(12, room);
    for (const cx of [-d.x / 4, d.x / 4]) {
      cylinder(
        g,
        { radius: r, length: h, axis: "z", center: { x: cx, y: 0, z: top + h / 2 } },
        material(COLORS.silver, { metal: true }),
        "transducer",
      );
    }
  }
  if (p.rfModuleMm > 0 && room > 0) {
    const sx = Math.min(p.rfModuleMm, d.x * 0.6);
    box(
      g,
      { x: sx, y: d.y * 0.75, z: Math.min(3.2, room) },
      { cx: d.x / 2 - sx / 2, cy: 0, z0: top },
      material(COLORS.silver, { metal: true }),
      "rf-module",
    );
  }
  return g;
}

/* ------------------------------------------------------------------------------------------ */

export const GENERATORS: Record<string, Generator> = Object.fromEntries(
  [
    define({
      name: "pcb_board",
      description:
        "Circuit board with optional headers, IC, USB, terminals, heatsink, inductor, screen.",
      params: pcbParams,
      build: buildPcb,
    }),
    define({
      name: "buck_module",
      description: "DC-DC converter module: board, power inductor, capacitors and trimpot.",
      params: pcbParams.extend({
        pcbColor: colorIndex(4),
        inductorMm: mm(12),
        capacitors: count(2, 6),
        potentiometer: flag(1),
      }),
      build: buildPcb,
    }),
    define({
      name: "header_row",
      description: "Standalone 2.54 mm pin header strip.",
      params: z.object({ rows: count(1, 2) }),
      build: (d, p) => {
        const g = new Group();
        headerStrip(g, {
          count: Math.max(1, Math.floor(d.x / 2.54)),
          rows: Math.max(1, p.rows),
          cx: 0,
          cy: 0,
          z0: 0,
          maxHeight: d.z,
        });
        return g;
      },
    }),
    define({
      name: "ir_sensor_array",
      description:
        "Reflectance sensor board: PCB on top, emitter/detector pairs facing down. Channels run along Y.",
      params: z.object({
        channels: z.number().int().min(1).max(32).default(1),
        pitchMm: mm(9.525),
        pcbColor: colorIndex(4),
        thicknessMm: mm(1.6),
        /** 0: two round LEDs per channel (TCRT5000-like), 1: flat SMD package (QTR-like). */
        packageStyle: count(1, 1),
      }),
      build: (d, p) => {
        const g = new Group();
        const t = clamp(p.thicknessMm, 0.4, d.z);
        box(
          g,
          { x: d.x, y: d.y, z: t },
          { cx: 0, cy: 0, z0: d.z - t },
          material(paletteColor(p.pcbColor)),
          "pcb",
        );
        const drop = d.z - t;
        if (drop <= 0) return g;
        const span = (p.channels - 1) * p.pitchMm;
        const pitch = span > d.y - 2 && p.channels > 1 ? (d.y - 2) / (p.channels - 1) : p.pitchMm;
        const start = (-(p.channels - 1) * pitch) / 2;
        const black = material(COLORS.black, { rough: 0.3 });
        for (let i = 0; i < p.channels; i++) {
          const cy = start + i * pitch;
          if (p.packageStyle === 0) {
            const r = Math.min(2.5, pitch / 2.2, d.x / 5);
            for (const cx of [-r * 1.1, r * 1.1]) {
              cylinder(
                g,
                { radius: r, length: drop, axis: "z", center: { x: cx, y: cy, z: drop / 2 } },
                i % 2 === 0 ? black : material(COLORS.blue, { rough: 0.2 }),
                "ir-led",
              );
            }
          } else {
            const s = Math.min(pitch * 0.8, 3.5, d.x * 0.6);
            box(
              g,
              { x: s, y: s * 0.8, z: Math.min(drop, 1.5) },
              { cx: 0, cy, z0: d.z - t - Math.min(drop, 1.5) },
              black,
              "ir-sensor",
            );
          }
        }
        return g;
      },
    }),
    define({
      name: "gearmotor_n20",
      description: "N20-size micro metal gearmotor. Axis along X, output shaft at +X.",
      params: z.object({
        gearboxLengthMm: mm(9),
        shaftLengthMm: mm(10),
        /** Extended rear shaft with a magnetic encoder board. */
        encoder: flag(0),
      }),
      build: (d, p) => {
        const g = new Group();
        const shaft = Math.min(p.shaftLengthMm, d.x * 0.4);
        const gear = Math.min(p.gearboxLengthMm, d.x - shaft - 1);
        const motor = d.x - shaft - gear;
        const x0 = -d.x / 2;
        const zc = d.z / 2;
        const can = cylinder(
          g,
          { radius: d.y / 2, length: motor, axis: "x", center: { x: x0 + motor / 2, y: 0, z: zc } },
          material(COLORS.silver, { metal: true }),
          "motor-can",
        );
        can.scale.set(1, 1, d.z / d.y); // N20 cans are flattened: 12 × 10 mm.
        box(
          g,
          { x: gear, y: d.y, z: d.z },
          { cx: x0 + motor + gear / 2, cy: 0, z0: 0 },
          material(COLORS.brass, { metal: true }),
          "gearbox",
        );
        cylinder(
          g,
          {
            radius: 1.5,
            length: shaft,
            axis: "x",
            center: { x: d.x / 2 - shaft / 2, y: 0, z: zc },
          },
          material(COLORS.silver, { metal: true }),
          "shaft",
        );
        if (p.encoder === 1) {
          box(
            g,
            { x: 1.2, y: d.y, z: d.z },
            { cx: x0 + 0.6, cy: 0, z0: 0 },
            material(COLORS.green),
            "encoder-board",
          );
        }
        return g;
      },
    }),
    define({
      name: "tt_motor",
      description: "Yellow 'TT' plastic gearmotor. Length along X, double output shaft along Y.",
      params: z.object({ motorLengthMm: mm(20), shaftLengthMm: mm(8) }),
      build: (d, p) => {
        const g = new Group();
        const shaft = Math.min(p.shaftLengthMm, d.y * 0.3);
        const bodyY = d.y - 2 * shaft;
        const motorLen = Math.min(p.motorLengthMm, d.x * 0.4);
        const gearLen = d.x - motorLen;
        box(
          g,
          { x: gearLen, y: bodyY, z: d.z },
          { cx: d.x / 2 - gearLen / 2, cy: 0, z0: 0 },
          material(COLORS.yellow),
          "gearbox",
        );
        cylinder(
          g,
          {
            radius: Math.min(bodyY, d.z) / 2,
            length: motorLen,
            axis: "x",
            center: { x: -d.x / 2 + motorLen / 2, y: 0, z: d.z / 2 },
          },
          material(COLORS.silver, { metal: true }),
          "motor-can",
        );
        cylinder(
          g,
          {
            radius: 2.7,
            length: d.y,
            axis: "y",
            center: { x: d.x / 2 - gearLen * 0.3, y: 0, z: d.z / 2 },
          },
          material(COLORS.white),
          "shaft",
        );
        return g;
      },
    }),
    define({
      name: "dc_motor_can",
      description:
        "Round DC motor (with optional gearbox) along X, shaft at +X. JGA25, coreless, 130-size.",
      params: z.object({ gearboxLengthMm: mm(0), shaftLengthMm: mm(8), color: colorIndex(8) }),
      build: (d, p) => {
        const g = new Group();
        const shaft = Math.min(p.shaftLengthMm, d.x * 0.35);
        const gear = Math.min(p.gearboxLengthMm, d.x - shaft - 1);
        const motor = d.x - shaft - gear;
        const r = Math.min(d.y, d.z) / 2;
        cylinder(
          g,
          {
            radius: r,
            length: motor,
            axis: "x",
            center: { x: -d.x / 2 + motor / 2, y: 0, z: d.z / 2 },
          },
          material(paletteColor(p.color), { metal: true }),
          "motor-can",
        );
        if (gear > 0) {
          cylinder(
            g,
            {
              radius: r,
              length: gear,
              axis: "x",
              center: { x: -d.x / 2 + motor + gear / 2, y: 0, z: d.z / 2 },
            },
            material(COLORS.brass, { metal: true }),
            "gearbox",
          );
        }
        cylinder(
          g,
          {
            radius: Math.min(2, r / 3),
            length: shaft,
            axis: "x",
            center: { x: d.x / 2 - shaft / 2, y: 0, z: d.z / 2 },
          },
          material(COLORS.silver, { metal: true }),
          "shaft",
        );
        return g;
      },
    }),
    define({
      name: "wheel",
      description:
        "Wheel with tyre. Rolls along X, axle along Y. dimensionsMm: x = z = diameter, y = width.",
      params: z.object({ tireMm: mm(3), hubColor: colorIndex(1), tireColor: colorIndex(0) }),
      build: (d, p) => {
        const g = new Group();
        const r = Math.min(d.x, d.z) / 2;
        const center = { x: 0, y: 0, z: r };
        cylinder(
          g,
          { radius: r, length: d.y * 0.96, axis: "y", center },
          material(paletteColor(p.tireColor), { rough: 0.9 }),
          "tire",
        );
        const hubR = Math.max(1, r - p.tireMm);
        cylinder(
          g,
          { radius: hubR, length: d.y, axis: "y", center, segments: 24 },
          material(paletteColor(p.hubColor)),
          "hub",
        );
        return g;
      },
    }),
    define({
      name: "ball_caster",
      description: "Ball caster: housing with a ball underneath.",
      params: z.object({
        ballDiameterMm: mm(9.5),
        housingColor: colorIndex(0),
        metalBall: flag(1),
      }),
      build: (d, p) => {
        const g = new Group();
        const r = Math.min(p.ballDiameterMm, d.x, d.y, d.z) / 2;
        sphere(
          g,
          { radius: r, center: { x: 0, y: 0, z: r } },
          p.metalBall === 1 ? material(COLORS.silver, { metal: true }) : material(COLORS.white),
          "ball",
        );
        const housingZ0 = r;
        const h = d.z - housingZ0;
        if (h > 0)
          box(
            g,
            { x: d.x, y: d.y, z: h },
            { cx: 0, cy: 0, z0: housingZ0 },
            material(paletteColor(p.housingColor)),
            "housing",
          );
        return g;
      },
    }),
    define({
      name: "battery_pack",
      description: "Rectangular battery pack (LiPo, 9 V block) with a coloured wrap.",
      params: z.object({ color: colorIndex(8), labelColor: colorIndex(2) }),
      build: (d, p) => {
        const g = new Group();
        box(
          g,
          { x: d.x, y: d.y, z: d.z },
          { cx: 0, cy: 0, z0: 0 },
          material(paletteColor(p.color), { rough: 0.35 }),
          "pack",
        );
        box(
          g,
          { x: d.x * 0.6, y: d.y * 1.0, z: d.z * 0.3 },
          { cx: 0, cy: 0, z0: d.z * 0.35 },
          material(paletteColor(p.labelColor)),
          "label",
        );
        return g;
      },
    }),
    define({
      name: "battery_holder",
      description:
        "Cylindrical-cell holder (18650, AA, AAA). Cells lie along X, side by side in Y.",
      params: z.object({
        cells: z.number().int().min(1).max(8).default(1),
        cellDiameterMm: mm(18.5),
        cellColor: colorIndex(4),
      }),
      build: (d, p) => {
        const g = new Group();
        const tray = Math.min(2, d.z * 0.2);
        box(
          g,
          { x: d.x, y: d.y, z: tray },
          { cx: 0, cy: 0, z0: 0 },
          material(COLORS.black),
          "tray",
        );
        const r = Math.min(p.cellDiameterMm / 2, d.y / (2 * p.cells), (d.z - tray) / 2);
        const pitch = d.y / p.cells;
        for (let i = 0; i < p.cells; i++) {
          cylinder(
            g,
            {
              radius: r,
              length: d.x * 0.92,
              axis: "x",
              center: { x: 0, y: -d.y / 2 + pitch / 2 + i * pitch, z: tray + r },
            },
            material(paletteColor(p.cellColor), { rough: 0.3 }),
            "cell",
          );
        }
        return g;
      },
    }),
    define({
      name: "edf_fan",
      description: "Ducted fan / suction impeller. Duct axis along Z.",
      params: z.object({ blades: count(11, 16), ductColor: colorIndex(0) }),
      build: (d, p) => {
        const g = new Group();
        const r = Math.min(d.x, d.y) / 2;
        cylinder(
          g,
          {
            radius: r,
            length: d.z,
            axis: "z",
            center: { x: 0, y: 0, z: d.z / 2 },
            openEnded: true,
          },
          material(paletteColor(p.ductColor), { doubleSided: true }),
          "duct",
        );
        const hubR = r * 0.35;
        cylinder(
          g,
          { radius: hubR, length: d.z * 0.9, axis: "z", center: { x: 0, y: 0, z: d.z / 2 } },
          material(COLORS.grey, { metal: true }),
          "hub",
        );
        for (let i = 0; i < p.blades; i++) {
          const blade = box(
            g,
            { x: r - hubR, y: 1, z: d.z * 0.3 },
            { cx: 0, cy: 0, z0: d.z * 0.55 },
            material(COLORS.grey),
            "blade",
          );
          const a = (i / Math.max(1, p.blades)) * Math.PI * 2;
          const mid = (r + hubR) / 2;
          blade.position.set(Math.cos(a) * mid, Math.sin(a) * mid, blade.position.z);
          blade.rotation.z = a;
        }
        return g;
      },
    }),
    define({
      name: "to220",
      description: "TO-220 package (LM7805 etc.) standing on its legs. Width along X.",
      params: z.object({ legLengthMm: mm(13) }),
      build: (d, p) => {
        const g = new Group();
        const legs = Math.min(p.legLengthMm, d.z * 0.5);
        const rest = d.z - legs;
        const tab = rest * 0.4;
        const silver = material(COLORS.silver, { metal: true });
        for (const cx of [-2.54, 0, 2.54])
          box(g, { x: 0.8, y: 0.5, z: legs }, { cx, cy: 0, z0: 0 }, silver, "leg");
        box(
          g,
          { x: d.x, y: d.y, z: rest - tab },
          { cx: 0, cy: 0, z0: legs },
          material(COLORS.black),
          "body",
        );
        box(
          g,
          { x: d.x, y: Math.min(1.3, d.y), z: tab },
          { cx: 0, cy: -d.y / 2 + Math.min(1.3, d.y) / 2, z0: legs + rest - tab },
          silver,
          "tab",
        );
        return g;
      },
    }),
    define({
      name: "switch_part",
      description: "Switch: 0 tactile push button, 1 slide switch, 2 rocker switch.",
      params: z.object({ kind: count(0, 2) }),
      build: (d, p) => {
        const g = new Group();
        if (p.kind === 0) {
          const base = d.z * 0.5;
          box(
            g,
            { x: d.x, y: d.y, z: base },
            { cx: 0, cy: 0, z0: 0 },
            material(COLORS.silver, { metal: true }),
            "body",
          );
          cylinder(
            g,
            {
              radius: Math.min(d.x, d.y) * 0.3,
              length: d.z - base,
              axis: "z",
              center: { x: 0, y: 0, z: base + (d.z - base) / 2 },
            },
            material(COLORS.black),
            "button",
          );
        } else if (p.kind === 1) {
          const base = d.z * 0.6;
          box(
            g,
            { x: d.x, y: d.y, z: base },
            { cx: 0, cy: 0, z0: 0 },
            material(COLORS.silver, { metal: true }),
            "body",
          );
          box(
            g,
            { x: d.x * 0.2, y: d.y * 0.4, z: d.z - base },
            { cx: d.x * 0.15, cy: 0, z0: base },
            material(COLORS.black),
            "lever",
          );
        } else {
          const base = d.z * 0.7;
          box(
            g,
            { x: d.x, y: d.y, z: base },
            { cx: 0, cy: 0, z0: 0 },
            material(COLORS.black),
            "body",
          );
          box(
            g,
            { x: d.x * 0.8, y: d.y * 0.8, z: d.z - base },
            { cx: 0, cy: 0, z0: base },
            material(COLORS.red),
            "rocker",
          );
        }
        return g;
      },
    }),
    define({
      name: "led_5mm",
      description: "Through-hole LED: legs, body and dome.",
      params: z.object({ color: colorIndex(2) }),
      build: (d, p) => {
        const g = new Group();
        const r = Math.min(d.x, d.y) / 2;
        const legs = d.z * 0.45;
        const silver = material(COLORS.silver, { metal: true });
        for (const cx of [-1.27, 1.27])
          box(
            g,
            { x: 0.5, y: 0.5, z: legs },
            { cx: Math.max(-r, Math.min(r, cx)), cy: 0, z0: 0 },
            silver,
            "leg",
          );
        const lens = material(paletteColor(p.color), { rough: 0.15 });
        const bodyH = Math.max(0, d.z - legs - r * 0.9);
        cylinder(
          g,
          {
            radius: r * 0.9,
            length: bodyH,
            axis: "z",
            center: { x: 0, y: 0, z: legs + bodyH / 2 },
          },
          lens,
          "body",
        );
        sphere(
          g,
          { radius: r * 0.9, center: { x: 0, y: 0, z: legs + bodyH }, hemisphere: true },
          lens,
          "dome",
        );
        return g;
      },
    }),
    define({
      name: "standoff",
      description: "Hex standoff or spacer along Z.",
      params: z.object({ color: colorIndex(9) }),
      build: (d, p) => {
        const g = new Group();
        cylinder(
          g,
          {
            radius: Math.min(d.x, d.y) / 2,
            length: d.z,
            axis: "z",
            center: { x: 0, y: 0, z: d.z / 2 },
            segments: 6,
          },
          material(paletteColor(p.color), { metal: p.color === 9 }),
          "standoff",
        );
        return g;
      },
    }),
    define({
      name: "generic_cylinder",
      description: "Plain cylinder (buzzers, round modules). axis: 0 = Z, 1 = X, 2 = Y.",
      params: z.object({ axis: count(0, 2), color: colorIndex(0) }),
      build: (d, p) => {
        const g = new Group();
        const axis = (["z", "x", "y"] as const)[p.axis] ?? "z";
        const along = axis === "z" ? d.z : axis === "x" ? d.x : d.y;
        const radius =
          axis === "z"
            ? Math.min(d.x, d.y) / 2
            : axis === "x"
              ? Math.min(d.y, d.z) / 2
              : Math.min(d.x, d.z) / 2;
        cylinder(
          g,
          {
            radius,
            length: along,
            axis,
            center: { x: 0, y: 0, z: axis === "z" ? d.z / 2 : radius },
          },
          material(paletteColor(p.color)),
          "cylinder",
        );
        return g;
      },
    }),
    define({
      name: "generic_box",
      description: "Fallback: a plain coloured box of the component's size.",
      params: z.object({ color: colorIndex(6) }),
      build: (d, p) => {
        const g = new Group();
        box(g, d, { cx: 0, cy: 0, z0: 0 }, material(paletteColor(p.color)), "box");
        return g;
      },
    }),
  ].map((gen) => [gen.name, gen]),
);
