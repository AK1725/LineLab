import { Box3, Mesh } from "three";
import { describe, expect, it } from "vitest";
import { GENERATORS, buildComponentModel, checkComponentModel } from "./index.js";
import type { Dims } from "./kit.js";

/** Representative dimensions and params per generator (mirrors real parts). */
const SAMPLES: Record<string, { dims: Dims; params: Record<string, number> }[]> = {
  pcb_board: [
    {
      dims: { x: 68.6, y: 53.4, z: 15 },
      params: { pcbColor: 10, usb: 2, barrelJack: 1, headerRows: 2, chipMm: 8 },
    },
    { dims: { x: 43, y: 43, z: 27 }, params: { pcbColor: 2, heatsinkMm: 23, screwTerminals: 3 } },
    { dims: { x: 27, y: 27, z: 5 }, params: { pcbColor: 4, screen: 1 } },
    { dims: { x: 45, y: 20, z: 15 }, params: { pcbColor: 4, transducers: 1 } },
    {
      dims: { x: 51, y: 28, z: 5 },
      params: { pcbColor: 0, rfModuleMm: 18, usb: 1, headerRows: 2 },
    },
  ],
  buck_module: [{ dims: { x: 43, y: 21, z: 14 }, params: {} }],
  header_row: [{ dims: { x: 25.4, y: 2.54, z: 8.5 }, params: {} }],
  ir_sensor_array: [
    { dims: { x: 12.7, y: 74.9, z: 3.2 }, params: { channels: 8, pitchMm: 9.525 } },
    { dims: { x: 10, y: 32, z: 11 }, params: { channels: 1, packageStyle: 0 } },
    { dims: { x: 12, y: 60, z: 11 }, params: { channels: 5, pitchMm: 11, packageStyle: 0 } },
  ],
  gearmotor_n20: [
    { dims: { x: 34, y: 12, z: 10 }, params: {} },
    { dims: { x: 40, y: 12, z: 10 }, params: { encoder: 1 } },
  ],
  tt_motor: [{ dims: { x: 70, y: 37, z: 22.5 }, params: {} }],
  dc_motor_can: [
    { dims: { x: 70, y: 25, z: 25 }, params: { gearboxLengthMm: 21 } },
    { dims: { x: 28, y: 8.5, z: 8.5 }, params: {} },
  ],
  wheel: [{ dims: { x: 32, y: 7, z: 32 }, params: {} }],
  ball_caster: [{ dims: { x: 21, y: 13, z: 11 }, params: { ballDiameterMm: 9.5 } }],
  battery_pack: [{ dims: { x: 56, y: 31, z: 14 }, params: {} }],
  battery_holder: [{ dims: { x: 77, y: 41, z: 21 }, params: { cells: 2 } }],
  edf_fan: [{ dims: { x: 30, y: 30, z: 24 }, params: {} }],
  to220: [{ dims: { x: 10, y: 4.5, z: 28 }, params: {} }],
  switch_part: [0, 1, 2].map((kind) => ({ dims: { x: 12, y: 6, z: 8 }, params: { kind } })),
  led_5mm: [{ dims: { x: 5.8, y: 5.8, z: 15 }, params: {} }],
  standoff: [{ dims: { x: 5.5, y: 5.5, z: 10 }, params: {} }],
  generic_cylinder: [0, 1, 2].map((axis) => ({ dims: { x: 12, y: 12, z: 9 }, params: { axis } })),
  generic_box: [{ dims: { x: 10, y: 20, z: 5 }, params: {} }],
};

const TOLERANCE_MM = 0.6;

describe("generators", () => {
  it("every registered generator has samples", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(Object.keys(GENERATORS).sort());
  });

  for (const [name, samples] of Object.entries(SAMPLES)) {
    samples.forEach((sample, i) => {
      it(`${name} #${i}: builds meshes that fit and fill the declared box`, () => {
        const c = {
          id: `test.${name}-${i}`,
          dimensionsMm: sample.dims,
          model: { kind: "procedural" as const, generator: name, params: sample.params },
        };
        expect(checkComponentModel(c)).toEqual([]);
        const group = buildComponentModel(c);

        let meshes = 0;
        group.traverse((o) => {
          if (o instanceof Mesh) meshes++;
        });
        expect(meshes).toBeGreaterThan(0);

        const bb = new Box3().setFromObject(group);
        const d = sample.dims;
        // Fits: never pokes outside the declared envelope.
        expect(bb.min.x).toBeGreaterThanOrEqual(-d.x / 2 - TOLERANCE_MM);
        expect(bb.max.x).toBeLessThanOrEqual(d.x / 2 + TOLERANCE_MM);
        expect(bb.min.y).toBeGreaterThanOrEqual(-d.y / 2 - TOLERANCE_MM);
        expect(bb.max.y).toBeLessThanOrEqual(d.y / 2 + TOLERANCE_MM);
        expect(bb.min.z).toBeGreaterThanOrEqual(-TOLERANCE_MM);
        expect(bb.max.z).toBeLessThanOrEqual(d.z + TOLERANCE_MM);
        // Fills: at least 60% of each axis, so the model is not a speck.
        expect(bb.max.x - bb.min.x).toBeGreaterThanOrEqual(d.x * 0.6);
        expect(bb.max.y - bb.min.y).toBeGreaterThanOrEqual(d.y * 0.6);
        expect(bb.max.z - bb.min.z).toBeGreaterThanOrEqual(d.z * 0.6);
      });
    });
  }
});

describe("checkComponentModel", () => {
  const dims = { x: 10, y: 10, z: 10 };

  it("rejects unknown generators", () => {
    const problems = checkComponentModel({
      id: "x.y",
      dimensionsMm: dims,
      model: { kind: "procedural", generator: "nope", params: {} },
    });
    expect(problems.join()).toMatch(/unknown generator "nope"/);
  });

  it("rejects unknown and out-of-range params", () => {
    const unknown = checkComponentModel({
      id: "x.y",
      dimensionsMm: dims,
      model: { kind: "procedural", generator: "wheel", params: { spokes: 5 } },
    });
    expect(unknown.join()).toMatch(/wheel: invalid params/);
    const range = checkComponentModel({
      id: "x.y",
      dimensionsMm: dims,
      model: { kind: "procedural", generator: "generic_box", params: { color: 99 } },
    });
    expect(range.join()).toMatch(/color/);
  });

  it("does not claim to support glTF yet", () => {
    const problems = checkComponentModel({
      id: "x.y",
      dimensionsMm: dims,
      model: { kind: "gltf", url: "https://example.com/a.glb", license: "CC0", attribution: "x" },
    });
    expect(problems.join()).toMatch(/not supported yet/);
  });

  it("buildComponentModel throws on invalid definitions", () => {
    expect(() =>
      buildComponentModel({
        id: "x.y",
        dimensionsMm: dims,
        model: { kind: "procedural", generator: "nope", params: {} },
      }),
    ).toThrow(/x\.y: unknown generator/);
  });
});
