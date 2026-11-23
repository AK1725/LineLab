import { CHASSIS, getChassis, getComponent } from "@linelab/component-db";
import type { Chassis, Component, Design, Placement } from "@linelab/schema";
import { describe, expect, it } from "vitest";
import { buildOutline, holeGrid } from "./chassis-builder.js";
import { collidingIds, findCollisions, footprintsOverlap } from "./collision.js";
import { defaultPlacement, newDesign } from "./defaults.js";
import { applyCommand } from "./history.js";
import { measure } from "./measure.js";
import { footprint, placementZ, quatFromYaw, yawOf } from "./placement.js";
import {
  area,
  centroid,
  convexHull,
  distanceToEdges,
  pointInPolygon,
  roundCorners,
  signedArea,
} from "./polygon.js";
import { snapPosition } from "./snap.js";

const comp = (id: string): Component => {
  const c = getComponent(id);
  if (!c) throw new Error(id);
  return c;
};
const chassis = (id: string): Chassis => {
  const c = getChassis(id);
  if (!c) throw new Error(id);
  return c;
};
const lookup = (id: string) => getComponent(id);

describe("polygon helpers", () => {
  const L = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 10 },
    { x: 10, y: 10 },
    { x: 10, y: 30 },
    { x: 0, y: 30 },
  ];

  it("area and centroid of an L shape", () => {
    // 20×10 (c 10,5) + 10×20 (c 5,20): area 400, x̄ = (200·10 + 200·5)/400 = 7.5, ȳ = (200·5 + 200·20)/400 = 12.5
    expect(area(L)).toBe(400);
    expect(centroid(L)).toEqual({ x: 7.5, y: 12.5 });
    expect(signedArea([...L].reverse())).toBe(-400);
  });

  it("point in polygon and distance to edges", () => {
    expect(pointInPolygon({ x: 5, y: 25 }, L)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 25 }, L)).toBe(false);
    expect(distanceToEdges({ x: 5, y: 5 }, L)).toBe(5);
  });

  it("convex hull drops interior points and fills notches", () => {
    const hull = convexHull([...L, { x: 5, y: 5 }]);
    expect(area(hull)).toBe(20 * 30 - (10 * 20) / 2);
  });

  it("rounding corners removes a little area and stays inside", () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 0, y: 40 },
    ];
    const r = roundCorners(sq, 5);
    const expected = 1600 - 4 * (25 - (Math.PI * 25) / 4);
    expect(area(r)).toBeGreaterThan(expected - 2);
    expect(area(r)).toBeLessThan(1600);
    for (const p of r)
      expect(p.x >= -1e-6 && p.x <= 40 + 1e-6 && p.y >= -1e-6 && p.y <= 40 + 1e-6).toBe(true);
  });
});

describe("chassis builder", () => {
  it("T-nose outline is counter-clockwise with the bar in front", () => {
    const o = buildOutline({
      preset: "t-nose",
      lengthMm: 60,
      widthMm: 80,
      rearOverhangMm: 25,
      noseLengthMm: 70,
      noseWidthMm: 20,
      barWidthMm: 90,
      barDepthMm: 15,
    });
    expect(signedArea(o)).toBeGreaterThan(0);
    expect(Math.max(...o.map((p) => p.x))).toBe(-25 + 60 + 70 + 15);
  });

  it("hole grid keeps its margin from edges and cutouts", () => {
    const o = buildOutline({ preset: "rectangle", lengthMm: 100, widthMm: 60, rearOverhangMm: 50 });
    const cut = [
      { x: -5, y: -5 },
      { x: 5, y: -5 },
      { x: 5, y: 5 },
      { x: -5, y: 5 },
    ];
    const holes = holeGrid(o, 10, 5, [cut]);
    expect(holes.length).toBeGreaterThan(10);
    for (const h of holes) {
      expect(distanceToEdges(h, o)).toBeGreaterThanOrEqual(5);
      expect(pointInPolygon(h, cut)).toBe(false);
    }
  });
});

describe("rotation helpers", () => {
  it("round-trips yaw through quaternions", () => {
    for (const yaw of [0, 0.3, Math.PI / 2, -Math.PI / 2, 3])
      expect(yawOf(quatFromYaw(yaw))).toBeCloseTo(yaw, 9);
  });
});

describe("collisions", () => {
  const part = comp("driver.tb6612fng");
  const at = (id: string, x: number, y: number, yaw = 0, z = 0): Placement => ({
    instanceId: id,
    componentId: part.id,
    position: { x, y, z },
    rotation: quatFromYaw(yaw),
    deck: 0,
    mount: "top",
    standoffMm: 0,
  });

  it("overlap, touching, rotation and height", () => {
    const a = footprint(at("a", 0, 0), part);
    expect(footprintsOverlap(a, footprint(at("b", 10, 0), part))).toBe(true);
    expect(footprintsOverlap(a, footprint(at("b", part.dimensionsMm.x, 0), part))).toBe(false); // touching edges
    expect(footprintsOverlap(a, footprint(at("b", 0, 0, 0, part.dimensionsMm.z), part))).toBe(
      false,
    ); // stacked
    // Rotating a 20.3 × 15.2 board by 90° makes it 15.2 long in X: at x = 18 the boards overlap
    // only when the second one is not rotated.
    expect(footprintsOverlap(a, footprint(at("b", 18, 0), part))).toBe(true);
    expect(footprintsOverlap(a, footprint(at("b", 18, 0, Math.PI / 2), part))).toBe(false);
  });

  it("reports parts that pass through the deck plate, but not through a cutout", () => {
    const ch = chassis("chassis.downforce-racer");
    const fan = comp("fan.edf-30mm");
    const design: Design = {
      ...newDesign("d", "d", { kind: "template", chassisId: ch.id }),
      placements: [
        {
          instanceId: "fan1",
          componentId: fan.id,
          position: { x: 45, y: 0, z: 5 },
          rotation: quatFromYaw(0),
          deck: 0,
          mount: "top",
          standoffMm: 0,
        },
      ],
    };
    expect(findCollisions(design, ch, lookup)).toEqual([]); // sits in the 32 mm fan hole
    const moved = applyCommand(design, {
      type: "update",
      changes: [{ id: "fan1", patch: { position: { x: -10, y: 0, z: 5 } } }],
    });
    expect(findCollisions(moved, ch, lookup)).toEqual([{ a: "fan1", b: "chassis:0" }]);
    expect(collidingIds(findCollisions(moved, ch, lookup))).toEqual(new Set(["fan1"]));
  });
});

describe("collision exemptions", () => {
  it("motors may overlap wheels (shaft in hub) but not other parts", () => {
    const ch = chassis("chassis.pcb-racer");
    const at = (id: string, componentId: string, x: number, y: number, z: number): Placement => ({
      instanceId: id,
      componentId,
      position: { x, y, z },
      rotation: quatFromYaw(componentId.startsWith("wheel.") ? 0 : Math.PI / 2),
      deck: 0,
      mount: "bottom",
      standoffMm: 0,
    });
    const d: Design = {
      ...newDesign("d", "d", { kind: "template", chassisId: ch.id }),
      placements: [
        at("m", "motor.n20-6v-1000rpm", 0, 40, 11),
        at("w", "wheel.pololu-32x7", 0, 45.5, 0),
        at("e", "motor.n20-6v-300rpm", 0, 20, 11),
      ],
    };
    expect(findCollisions(d, ch, lookup)).toEqual([{ a: "m", b: "e" }]);
  });
});

describe("snapping", () => {
  const ch = chassis("chassis.starter-2wd");

  it("wheels snap to wheel mounts, casters to caster mounts", () => {
    expect(snapPosition({ x: 4, y: 60 }, comp("wheel.tt-65mm"), 0, ch, { gridMm: 5 })).toEqual({
      x: 0,
      y: 66,
      kind: "wheel-mount",
    });
    expect(
      snapPosition({ x: -61, y: 3 }, comp("caster.pololu-ball-3-4-metal"), 0, ch, { gridMm: 5 }),
    ).toEqual({ x: -65, y: 0, kind: "caster-mount" });
  });

  it("aligns a board's own mounting hole with a chassis hole", () => {
    const uno = comp("mcu.arduino-uno-r3");
    const hole = uno.mountingHoles?.[0];
    const target = ch.mountPoints[10];
    if (!hole || !target) throw new Error("fixture");
    const desired = { x: target.x - hole.x + 1.2, y: target.y - hole.y - 0.8 };
    const s = snapPosition(desired, uno, 0, ch, { gridMm: 5 });
    expect(s.kind).toBe("mount-hole");
    expect(s.x + hole.x).toBeCloseTo(target.x, 9);
    expect(s.y + hole.y).toBeCloseTo(target.y, 9);
  });

  it("snaps flush to the deck edge, otherwise to the grid", () => {
    const drv = comp("driver.tb6612fng");
    const edge = snapPosition({ x: 70 - drv.dimensionsMm.x / 2 - 1.2, y: 3.3 }, drv, 0, ch, {
      gridMm: 5,
    });
    expect(edge.kind).toBe("edge");
    expect(edge.x).toBeCloseTo(70 - drv.dimensionsMm.x / 2, 9);
    expect(edge.y).toBe(5);
    expect(snapPosition({ x: 12.4, y: -7.6 }, drv, 0.3, ch, { gridMm: 5 })).toEqual({
      x: 10,
      y: -10,
      kind: "grid",
    });
    expect(snapPosition({ x: 12.4, y: -7.6 }, drv, 0.3, ch, { gridMm: 0 })).toEqual({
      x: 12.4,
      y: -7.6,
      kind: "none",
    });
  });
});

describe("default placement builds a clean robot on every template", () => {
  const partsFor = (c: Chassis) => {
    const tt = c.wheelMounts[0] !== undefined && c.wheelMounts[0].axleHeightMm > 30;
    return [
      "mcu.arduino-nano",
      "driver.tb6612fng",
      "sensor.pololu-qtr-8a",
      ...c.wheelMounts.flatMap(() => [tt ? "motor.tt-1-48" : "motor.n20-6v-1000rpm"]),
      ...c.wheelMounts.flatMap(() => [tt ? "wheel.tt-65mm" : "wheel.pololu-32x7"]),
      ...c.casterMounts.map(() => "caster.nylon-skid"),
      // Small chassis carry the small pack, as real compact robots do.
      area(c.outline) < 9000 ? "battery.lipo-2s-300mah" : "battery.lipo-2s-450mah",
    ];
  };

  for (const ch of CHASSIS) {
    it(ch.id, () => {
      let d = newDesign("d", "d", { kind: "template", chassisId: ch.id });
      for (const id of partsFor(ch))
        d = applyCommand(d, {
          type: "add",
          placements: [defaultPlacement(comp(id), d, ch, lookup)],
        });
      expect(findCollisions(d, ch, lookup)).toEqual([]);

      const m = measure(d, ch, lookup);
      expect(m.trackWidthMm).toBeGreaterThan(50);
      expect(m.lookaheadMm).toBeGreaterThan(30);
      expect(m.sensorClearanceMm).toBeDefined();

      // Wheels sit on the ground at their mounts; motors point their shafts at the wheels.
      for (const p of d.placements.filter((x) => x.componentId.startsWith("wheel.")))
        expect(p.position.z).toBe(0);
      const motors = d.placements.filter((x) => x.componentId === "motor.n20-6v-1000rpm");
      for (const m2 of motors) expect(Math.abs(yawOf(m2.rotation))).toBeCloseTo(Math.PI / 2, 9);
    });
  }

  it("spacers raise top parts and lower bottom parts", () => {
    const ch = chassis("chassis.pcb-racer");
    const qtr = comp("sensor.pololu-qtr-8a");
    const deckBottom = 22.6 - 1.6;
    expect(placementZ(ch, qtr, 0, "bottom")).toBeCloseTo(deckBottom - qtr.dimensionsMm.z, 9);
    expect(placementZ(ch, qtr, 0, "bottom", 14)).toBeCloseTo(
      deckBottom - 14 - qtr.dimensionsMm.z,
      9,
    );
    expect(placementZ(ch, qtr, 0, "top", 5)).toBeCloseTo(22.6 + 5, 9);
    expect(placementZ(ch, comp("wheel.pololu-32x7"), 0, "bottom", 10)).toBe(0);
  });

  it("motors under the PCB racer sit with their axle at wheel-axle height", () => {
    const ch = chassis("chassis.pcb-racer");
    const n20 = comp("motor.n20-6v-1000rpm");
    const z = placementZ(ch, n20, 0, "bottom");
    expect(z + n20.dimensionsMm.z / 2).toBeCloseTo(ch.wheelMounts[0]?.axleHeightMm ?? 0, 9);
  });
});
