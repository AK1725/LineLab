import type { Chassis, Polygon, Vec2 } from "@linelab/schema";
import { ExtrudeGeometry, Path, Shape, Vector2 } from "three";
import { DEFAULT_HOLE_DIAMETER_MM } from "../mass.js";
import { circlePolygon, convexHull, ensureCCW, round2 } from "../polygon.js";

/** ASCII STL (mm) of the deck-0 plate: outline extruded by the thickness, with cutouts and holes. */
export function chassisToStl(chassis: Chassis): string {
  const shape = new Shape(ensureCCW(chassis.outline).map((p) => new Vector2(p.x, p.y)));
  const hole = (poly: Polygon) =>
    new Path([...ensureCCW(poly)].reverse().map((p) => new Vector2(p.x, p.y)));
  for (const c of chassis.cutouts ?? []) shape.holes.push(hole(c));
  const r = (chassis.mountHoleDiameterMm ?? DEFAULT_HOLE_DIAMETER_MM) / 2;
  for (const m of chassis.mountPoints) shape.holes.push(hole(circlePolygon(m, r, 16)));

  const geom = new ExtrudeGeometry(shape, {
    depth: chassis.thicknessMm,
    bevelEnabled: false,
    curveSegments: 1,
  });
  const nonIndexed = geom.index ? geom.toNonIndexed() : geom;
  const pos = nonIndexed.getAttribute("position");
  const lines = ["solid linelab_chassis"];
  const f = (n: number) => n.toExponential(6);
  for (let i = 0; i + 2 < pos.count; i += 3) {
    const a = [pos.getX(i), pos.getY(i), pos.getZ(i)] as const;
    const b = [pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1)] as const;
    const c = [pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2)] as const;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nx = (u[1] ?? 0) * (v[2] ?? 0) - (u[2] ?? 0) * (v[1] ?? 0);
    const ny = (u[2] ?? 0) * (v[0] ?? 0) - (u[0] ?? 0) * (v[2] ?? 0);
    const nz = (u[0] ?? 0) * (v[1] ?? 0) - (u[1] ?? 0) * (v[0] ?? 0);
    const len = Math.hypot(nx, ny, nz) || 1;
    lines.push(`facet normal ${f(nx / len)} ${f(ny / len)} ${f(nz / len)}`, "  outer loop");
    for (const p of [a, b, c]) lines.push(`    vertex ${f(p[0])} ${f(p[1])} ${f(p[2])}`);
    lines.push("  endloop", "endfacet");
  }
  lines.push("endsolid linelab_chassis");
  geom.dispose();
  return `${lines.join("\n")}\n`;
}

/** All vertices of an ASCII or binary STL. */
export function readStlVertices(data: ArrayBuffer): { x: number; y: number; z: number }[] {
  const bytes = new Uint8Array(data);
  const head = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 512)));
  const view = new DataView(data);
  const binaryCount = bytes.length >= 84 ? view.getUint32(80, true) : -1;
  const looksBinary = binaryCount >= 0 && 84 + binaryCount * 50 === bytes.length;
  const out: { x: number; y: number; z: number }[] = [];
  if (!looksBinary && /^\s*solid/i.test(head)) {
    const text = new TextDecoder().decode(bytes);
    for (const m of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) {
      out.push({ x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) });
    }
    return out;
  }
  if (!looksBinary) throw new Error("Not a valid STL file.");
  for (let t = 0; t < binaryCount; t++) {
    const base = 84 + t * 50 + 12;
    for (let v = 0; v < 3; v++) {
      const o = base + v * 12;
      out.push({
        x: view.getFloat32(o, true),
        y: view.getFloat32(o + 4, true),
        z: view.getFloat32(o + 8, true),
      });
    }
  }
  return out;
}

/**
 * Approximates a chassis from a plate STL: the outline is the **convex hull** of the top view
 * (concave notches are filled in) and the thickness is the Z extent. Re-draw concave shapes
 * as DXF or SVG for an exact outline.
 */
export function parseStlOutline(data: ArrayBuffer): {
  outline: Polygon;
  thicknessMm: number;
  warnings: string[];
} {
  const verts = readStlVertices(data);
  if (verts.length < 3) throw new Error("The STL file has no triangles.");
  const hull = convexHull(verts.map((v) => ({ x: round2(v.x), y: round2(v.y) })));
  const zs = verts.map((v) => v.z);
  const xs = hull.map((p) => p.x);
  const ys = hull.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const outline: Vec2[] = hull.map((p) => ({ x: round2(p.x - cx), y: round2(p.y - cy) }));
  return {
    outline,
    thicknessMm: round2(Math.max(...zs) - Math.min(...zs)),
    warnings: ["STL import uses the convex hull of the top view: notches and holes are not kept."],
  };
}
