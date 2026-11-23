import type { Chassis, Component, Design } from "@linelab/schema";
import { describe, expect, it } from "vitest";
import { chassisMassProps, designMassProps } from "./mass.js";
import { quatFromYaw } from "./placement.js";

const plate = (over: Partial<Chassis> = {}): Chassis => ({
  id: "chassis.test",
  name: "test",
  outline: [
    { x: -50, y: -25 },
    { x: 50, y: -25 },
    { x: 50, y: 25 },
    { x: -50, y: 25 },
  ],
  thicknessMm: 2,
  material: "acrylic",
  densityGcm3: 1,
  decks: [{ index: 0, heightMm: 20 }],
  mountPoints: [],
  wheelMounts: [
    { side: "left", position: { x: 0, y: 30 }, axleHeightMm: 16 },
    { side: "right", position: { x: 0, y: -30 }, axleHeightMm: 16 },
  ],
  casterMounts: [],
  ...over,
});

const part = (id: string, massG: number, dims: [number, number, number]): Component => ({
  id,
  name: id,
  aliases: [],
  category: "misc",
  dimensionsMm: { x: dims[0], y: dims[1], z: dims[2] },
  massG,
  model: { kind: "procedural", generator: "generic_box", params: {} },
  pins: [],
  electrical: { kind: "generic" },
  specStatus: "needs-review",
  license: "CC-BY-SA-4.0",
  sources: ["https://example.com"],
});

describe("chassisMassProps", () => {
  it("plain plate: mass = area × thickness × density, CoG mid-plate", () => {
    // 100 × 50 mm × 2 mm = 10 000 mm³ = 10 cm³ → 10 g at 1 g/cm³.
    const m = chassisMassProps(plate());
    expect(m.massG).toBeCloseTo(10, 9);
    expect(m.cog.x).toBeCloseTo(0, 9);
    expect(m.cog.y).toBeCloseTo(0, 9);
    expect(m.cog.z).toBeCloseTo(19, 9);
  });

  it("subtracts cutouts and holes and shifts the CoG away from them", () => {
    // 10 × 10 cutout centred at (20, 0): area 4900, x̄ = −100·20 / 4900.
    const cut = [
      { x: 15, y: -5 },
      { x: 25, y: -5 },
      { x: 25, y: 5 },
      { x: 15, y: 5 },
    ];
    const m = chassisMassProps(plate({ thicknessMm: 1, cutouts: [cut] }));
    expect(m.massG).toBeCloseTo(4.9, 9);
    expect(m.cog.x).toBeCloseTo((-100 * 20) / 4900, 9);

    // One 2 mm hole at (0, 10): area π.
    const h = chassisMassProps(
      plate({ thicknessMm: 1, mountPoints: [{ x: 0, y: 10 }], mountHoleDiameterMm: 2 }),
    );
    expect(h.massG).toBeCloseTo((5000 - Math.PI) / 1000, 9);
    expect(h.cog.y).toBeCloseTo((-Math.PI * 10) / (5000 - Math.PI), 9);
  });

  it("adds every deck at its own height", () => {
    const m = chassisMassProps(
      plate({
        decks: [
          { index: 0, heightMm: 20 },
          { index: 1, heightMm: 50 },
        ],
      }),
    );
    expect(m.massG).toBeCloseTo(20, 9);
    expect(m.cog.z).toBeCloseTo((19 + 49) / 2, 9);
  });
});

describe("designMassProps (hand-calculated fixture)", () => {
  it("matches the worked example", () => {
    // Plate 10 g @ (0, 0, 19); A 30 g, 20×20×10 placed at (30, 0, 20) → CoG (30, 0, 25);
    // B 10 g, 10×10×4 placed at (−40, 10, 20) → CoG (−40, 10, 22).
    // Total 50 g; x = (0 + 900 − 400) / 50 = 10; y = 100 / 50 = 2; z = (190 + 750 + 220) / 50 = 23.2.
    const A = part("misc.a", 30, [20, 20, 10]);
    const B = part("misc.b", 10, [10, 10, 4]);
    const design: Design = {
      id: "d",
      name: "d",
      version: 1,
      chassis: { kind: "custom", chassis: plate() },
      placements: [
        {
          instanceId: "a",
          componentId: A.id,
          position: { x: 30, y: 0, z: 20 },
          rotation: quatFromYaw(0),
          deck: 0,
          mount: "top",
          standoffMm: 0,
        },
        {
          instanceId: "b",
          componentId: B.id,
          position: { x: -40, y: 10, z: 20 },
          rotation: quatFromYaw(Math.PI / 2),
          deck: 0,
          mount: "top",
          standoffMm: 0,
        },
      ],
      netlist: [],
    };
    const lookup = (id: string) => [A, B].find((c) => c.id === id);
    const m = designMassProps(design, plate(), lookup);
    expect(m.massG).toBeCloseTo(50, 9);
    expect(m.cog.x).toBeCloseTo(10, 9);
    expect(m.cog.y).toBeCloseTo(2, 9);
    expect(m.cog.z).toBeCloseTo(23.2, 9);
    expect(m.parts).toHaveLength(2);
  });

  it("ignores placements whose component is unknown", () => {
    const design: Design = {
      id: "d",
      name: "d",
      version: 1,
      chassis: { kind: "custom", chassis: plate() },
      placements: [
        {
          instanceId: "x",
          componentId: "misc.ghost",
          position: { x: 0, y: 0, z: 0 },
          rotation: quatFromYaw(0),
          deck: 0,
          mount: "top",
          standoffMm: 0,
        },
      ],
      netlist: [],
    };
    expect(designMassProps(design, plate(), () => undefined).massG).toBeCloseTo(10, 9);
  });
});
