import { getChassis } from "@linelab/component-db";
import { Chassis } from "@linelab/schema";
import { describe, expect, it } from "vitest";
import { makeCustomChassis } from "./chassis-builder.js";
import { chassisToDxf, parseDxfOutline } from "./io/dxf.js";
import { chassisToStl, parseStlOutline, readStlVertices } from "./io/stl.js";
import { parseSvgOutline } from "./io/svg.js";
import { area, bounds } from "./polygon.js";

const racer = getChassis("chassis.pcb-racer");
const down = getChassis("chassis.downforce-racer");
if (!racer || !down) throw new Error("fixture chassis missing");

const enc = (s: string) => new TextEncoder().encode(s).buffer;

describe("DXF", () => {
  it("round-trips outline, cutouts and holes", () => {
    const parsed = parseDxfOutline(chassisToDxf(down));
    expect(parsed.outline).toEqual(down.outline);
    expect(parsed.cutouts).toEqual(down.cutouts);
    expect(parsed.holes).toEqual(down.mountPoints);
    expect(parsed.holeDiameterMm).toBe(3.2);
  });

  it("declares millimetres", () => {
    expect(chassisToDxf(racer)).toMatch(/\$INSUNITS\n70\n4\n/);
  });

  it("chains loose LINE + ARC entities into a closed rounded outline", () => {
    // 40 × 20 rectangle whose right end is a half circle (r = 10) drawn as an ARC.
    const dxf = [
      "0",
      "SECTION",
      "2",
      "ENTITIES",
      "0",
      "LINE",
      "10",
      "0",
      "20",
      "0",
      "11",
      "40",
      "21",
      "0",
      "0",
      "ARC",
      "10",
      "40",
      "20",
      "10",
      "40",
      "10",
      "50",
      "270",
      "51",
      "90",
      "0",
      "LINE",
      "10",
      "40",
      "20",
      "20",
      "11",
      "0",
      "21",
      "20",
      "0",
      "LINE",
      "10",
      "0",
      "20",
      "20",
      "11",
      "0",
      "21",
      "0",
      "0",
      "ENDSEC",
      "0",
      "EOF",
    ].join("\n");
    const p = parseDxfOutline(dxf);
    expect(area(p.outline)).toBeGreaterThan(800 + Math.PI * 50 - 5);
    expect(area(p.outline)).toBeLessThan(800 + Math.PI * 50 + 1);
  });

  it("honours LWPOLYLINE bulges (rounded corners)", () => {
    // Square with one bulged edge (bulge 1 = semicircle) on the right side.
    const dxf = [
      "0",
      "LWPOLYLINE",
      "70",
      "1",
      "10",
      "0",
      "20",
      "0",
      "10",
      "20",
      "20",
      "0",
      "42",
      "1",
      "10",
      "20",
      "20",
      "20",
      "10",
      "0",
      "20",
      "20",
      "0",
      "EOF",
    ].join("\n");
    const p = parseDxfOutline(dxf);
    expect(bounds(p.outline).maxX).toBeCloseTo(30, 0);
  });

  it("explains when there is no closed shape", () => {
    expect(() =>
      parseDxfOutline(
        ["0", "LINE", "10", "0", "20", "0", "11", "5", "21", "0", "0", "EOF"].join("\n"),
      ),
    ).toThrow(/No closed outline/);
  });
});

describe("SVG", () => {
  it("reads a mm-scaled drawing, flips Y and turns small circles into holes", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="100mm" viewBox="0 0 100 50">
      <rect x="0" y="0" width="100" height="50"/>
      <path d="M 40 15 h 20 v 20 h -20 z"/>
      <circle cx="10" cy="10" r="0.8"/>
    </svg>`;
    const p = parseSvgOutline(svg);
    expect(area(p.outline)).toBeCloseTo(200 * 100, 6); // scale 2 mm per unit
    expect(p.cutouts).toHaveLength(1);
    expect(area(p.cutouts[0] ?? [])).toBeCloseTo(40 * 40, 6);
    expect(p.holeDiameterMm).toBeCloseTo(3.2, 6);
    // Centred, Y flipped: hole at (10,10) user units → (20,20) mm from top-left → (-80, +30).
    expect(p.holes).toEqual([{ x: -80, y: 30 }]);
  });

  it("samples bezier curves in paths", () => {
    const p = parseSvgOutline(`<svg><path d="M0 0 L50 0 C 70 0 70 40 50 40 L 0 40 Z"/></svg>`);
    expect(p.outline.length).toBeGreaterThan(8);
    expect(bounds(p.outline).maxX - bounds(p.outline).minX).toBeGreaterThan(60);
  });
});

describe("STL", () => {
  it("exports a closed plate whose thickness and hull come back on import", () => {
    const stl = chassisToStl(down);
    expect(stl.startsWith("solid linelab_chassis")).toBe(true);
    const back = parseStlOutline(enc(stl));
    expect(back.thicknessMm).toBeCloseTo(down.thicknessMm, 6);
    expect(area(back.outline)).toBeCloseTo(area(down.outline), 0); // convex outline survives the hull
    expect(back.warnings.join()).toMatch(/convex hull/);
  });

  it("reads binary STL", () => {
    const tri = [
      [0, 0, 0],
      [10, 0, 0],
      [0, 10, 2],
    ];
    const buf = new ArrayBuffer(84 + 50);
    const v = new DataView(buf);
    v.setUint32(80, 1, true);
    tri.forEach((p, i) => {
      p.forEach((c, j) => {
        v.setFloat32(84 + 12 + i * 12 + j * 4, c, true);
      });
    });
    expect(readStlVertices(buf)).toHaveLength(3);
    expect(parseStlOutline(buf).thicknessMm).toBe(2);
  });

  it("rejects garbage", () => {
    expect(() => readStlVertices(enc("not an stl at all"))).toThrow(/Not a valid STL/);
  });
});

describe("makeCustomChassis", () => {
  it("produces a schema-valid chassis from an imported outline", () => {
    const imported = parseDxfOutline(chassisToDxf(racer));
    const c = makeCustomChassis({
      id: "chassis.custom-1",
      name: "Mine",
      outline: imported.outline,
      cutouts: imported.cutouts,
      thicknessMm: 1.6,
      material: "fr4",
      deckHeightMm: 22.6,
      trackHalfMm: 45.5,
      axleHeightMm: 16,
      casterMounts: [{ x: 135, y: 0 }],
      holePitchMm: 10,
    });
    expect(Chassis.safeParse(c).success).toBe(true);
    expect(c.densityGcm3).toBe(1.85);
    expect(c.mountPoints.length).toBeGreaterThan(20);
  });
});
