import type { Chassis } from "@linelab/schema";
import { Box3, Mesh } from "three";
import { describe, expect, it } from "vitest";
import { GENERATORS, buildChassisModel, buildComponentModel, mergeByMaterial } from "./index.js";

const chassis: Chassis = {
  id: "chassis.t",
  name: "t",
  outline: [
    { x: -50, y: -30 },
    { x: 60, y: -30 },
    { x: 60, y: 30 },
    { x: -50, y: 30 },
  ],
  cutouts: [
    [
      { x: 0, y: -5 },
      { x: 10, y: -5 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ],
  ],
  thicknessMm: 3,
  material: "acrylic",
  densityGcm3: 1.18,
  decks: [
    { index: 0, heightMm: 25 },
    {
      index: 1,
      heightMm: 60,
      outline: [
        { x: -20, y: -20 },
        { x: 20, y: -20 },
        { x: 20, y: 20 },
        { x: -20, y: 20 },
      ],
    },
  ],
  mountPoints: [{ x: 30, y: 0 }],
  wheelMounts: [
    { side: "left", position: { x: 0, y: 35 }, axleHeightMm: 16 },
    { side: "right", position: { x: 0, y: -35 }, axleHeightMm: 16 },
  ],
  casterMounts: [],
};

describe("buildChassisModel", () => {
  it("builds one plate per deck at the right height and extent", () => {
    const g = buildChassisModel(chassis);
    const meshes = g.children.filter((c): c is Mesh => c instanceof Mesh);
    expect(meshes).toHaveLength(2);
    const bb0 = new Box3().setFromObject(meshes[0] as Mesh);
    expect(bb0.min.toArray().map((v) => Math.round(v * 100) / 100)).toEqual([-50, -30, 22]);
    expect(bb0.max.toArray().map((v) => Math.round(v * 100) / 100)).toEqual([60, 30, 25]);
    const bb1 = new Box3().setFromObject(meshes[1] as Mesh);
    expect(bb1.max.z).toBeCloseTo(60, 6);
    expect(bb1.max.x).toBeCloseTo(20, 6);
  });
});

describe("mergeByMaterial", () => {
  it("keeps the bounding box but collapses meshes to one per material", () => {
    const uno = {
      id: "x.uno",
      dimensionsMm: { x: 68.6, y: 53.4, z: 15 },
      model: {
        kind: "procedural" as const,
        generator: "pcb_board",
        params: { pcbColor: 10, usb: 2, barrelJack: 1, headerRows: 2, chipMm: 8 },
      },
    };
    const original = buildComponentModel(uno);
    let before = 0;
    original.traverse((o) => {
      if (o instanceof Mesh) before++;
    });
    const merged = mergeByMaterial(original);
    expect(merged.children.length).toBeLessThan(before / 5);
    const a = new Box3().setFromObject(original);
    const b = new Box3().setFromObject(merged);
    expect(b.min.distanceTo(a.min)).toBeLessThan(1e-6);
    expect(b.max.distanceTo(a.max)).toBeLessThan(1e-6);
  });

  it("works for every generator", () => {
    for (const name of Object.keys(GENERATORS)) {
      const m = mergeByMaterial(
        buildComponentModel({
          id: `x.${name}`,
          dimensionsMm: { x: 30, y: 30, z: 20 },
          model: {
            kind: "procedural",
            generator: name,
            params: name === "ir_sensor_array" ? { channels: 3 } : {},
          },
        }),
      );
      expect(m.children.length, name).toBeGreaterThan(0);
    }
  });
});
