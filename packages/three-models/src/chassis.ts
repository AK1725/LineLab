import type { Chassis, Vec2 } from "@linelab/schema";
import { ExtrudeGeometry, Group, Mesh, Path, Shape, Vector2 } from "three";
import { COLORS, material } from "./kit.js";

const PLATE_COLOR: Record<Chassis["material"], number> = {
  acrylic: 0xd9e6f2,
  fr4: 0x1d6b3a,
  pla: 0xe8e2d4,
  petg: 0xcfe3ea,
  carbon_fiber: 0x2b2d31,
  aluminium: COLORS.silver,
  plywood: 0xc8a26e,
};

const signedArea = (p: readonly Vec2[]) =>
  p.reduce((s, a, i) => {
    const b = p[(i + 1) % p.length] as Vec2;
    return s + a.x * b.y - b.x * a.y;
  }, 0) / 2;
const ccw = (p: readonly Vec2[]) => (signedArea(p) < 0 ? [...p].reverse() : [...p]);
const cw = (p: readonly Vec2[]) => ccw(p).reverse();

function hole(center: Vec2, r: number, n = 12): Vec2[] {
  return Array.from({ length: n }, (_, i) => ({
    x: center.x + r * Math.cos((-2 * Math.PI * i) / n),
    y: center.y + r * Math.sin((-2 * Math.PI * i) / n),
  }));
}

/**
 * The chassis plates (every deck) as extruded meshes in the chassis frame: mm, Z up, origin at
 * the drive-axle midpoint on the ground. Deck 0 gets cutouts; decks using the main outline get
 * the mounting holes. Materials are shared; dispose geometries only.
 */
export function buildChassisModel(
  chassis: Chassis,
  opts: { holes?: boolean; opacity?: number } = {},
): Group {
  const group = new Group();
  group.name = "chassis";
  let mat = material(PLATE_COLOR[chassis.material], {
    rough: chassis.material === "acrylic" ? 0.25 : 0.7,
  });
  if (opts.opacity !== undefined && opts.opacity < 1) {
    // A private translucent copy, so parts under the plate stay visible from above.
    mat = mat.clone();
    mat.transparent = true;
    mat.opacity = opts.opacity;
    mat.depthWrite = false;
  }
  const r = (chassis.mountHoleDiameterMm ?? 3.2) / 2;
  for (const deck of chassis.decks) {
    const outline = deck.outline ?? chassis.outline;
    const shape = new Shape(ccw(outline).map((p) => new Vector2(p.x, p.y)));
    const holes: Vec2[][] = [];
    if (deck.index === 0) holes.push(...(chassis.cutouts ?? []).map(cw));
    if (deck.outline === undefined && opts.holes !== false)
      holes.push(...chassis.mountPoints.map((m) => hole(m, r)));
    for (const h of holes) shape.holes.push(new Path(h.map((p) => new Vector2(p.x, p.y))));
    const geom = new ExtrudeGeometry(shape, {
      depth: chassis.thicknessMm,
      bevelEnabled: false,
      curveSegments: 1,
    });
    const mesh = new Mesh(geom, mat);
    mesh.name = `deck-${deck.index}`;
    mesh.position.z = deck.heightMm - chassis.thicknessMm;
    mesh.userData.deck = deck.index;
    group.add(mesh);
  }
  return group;
}
