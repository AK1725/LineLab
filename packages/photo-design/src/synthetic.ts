import type { Chassis, Design, PhotoBox, PhotoDetection, Vec2 } from "@linelab/schema";
import { bounds, footprint, footprintCorners, type Lookup } from "@linelab/design-core";

export interface SyntheticTopView {
  widthPx: number;
  heightPx: number;
  mmPerPx: number;
  /** Convex hull of the chassis plate and wheels, as fractions of the image (the vision service
   * returns the true, possibly concave, silhouette; both work for the proposal). */
  outline: Vec2[];
  /** Box per component id (wheels: one box around the pair), as fractions of the image. */
  boxes: Map<string, PhotoBox>;
  /** An SVG drawing of the view (a schematic "render", not a photo). */
  svg: string;
}

const hull = (pts: Vec2[]): Vec2[] => {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (xs: Vec2[]) => {
    const h: Vec2[] = [];
    for (const q of xs) {
      while (h.length >= 2 && cross(h[h.length - 2] ?? q, h[h.length - 1] ?? q, q) <= 0) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  return [...half(p), ...half([...p].reverse())];
};

/**
 * A perfect overhead camera over a known design, front up: what an ideal detector would report.
 * Used to test scale, placement and chassis estimation against ground truth, and to draw the
 * fixture "top photos" (clearly renders) for the photo wizard's tests.
 */
export function syntheticTopView(
  design: Design,
  chassis: Chassis,
  lookup: Lookup,
  mmPerPx = 0.25,
  marginMm = 20,
): SyntheticTopView {
  const parts = design.placements.flatMap((p) => {
    const c = lookup(p.componentId);
    return c ? [{ p, c, corners: footprintCorners(footprint(p, c)) }] : [];
  });
  const wheels = parts.filter((x) => x.c.category === "wheel");
  const silhouette = hull([...chassis.outline, ...wheels.flatMap((w) => w.corners)]);
  const b = bounds(silhouette);
  const W = Math.round((b.maxY - b.minY + 2 * marginMm) / mmPerPx);
  const H = Math.round((b.maxX - b.minX + 2 * marginMm) / mmPerPx);
  // Front up: image u grows to the robot's right (−y), v grows backwards (−x).
  const px = (q: Vec2): Vec2 => ({
    x: (b.maxY + marginMm - q.y) / mmPerPx,
    y: (b.maxX + marginMm - q.x) / mmPerPx,
  });
  const frac = (q: Vec2): Vec2 => ({ x: px(q).x / W, y: px(q).y / H });
  const boxOf = (pts: Vec2[]): PhotoBox => {
    const f = pts.map(frac);
    const xs = f.map((q) => q.x);
    const ys = f.map((q) => q.y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  };
  const boxes = new Map<string, PhotoBox>();
  for (const id of new Set(parts.map((x) => x.c.id))) {
    const same = parts.filter((x) => x.c.id === id);
    const c = same[0]?.c;
    // Only what an overhead camera sees: top-mounted parts, and the wheels.
    if (!c || (same[0]?.p.mount === "bottom" && c.category !== "wheel")) continue;
    boxes.set(id, boxOf(same.flatMap((x) => x.corners)));
  }
  const poly = (pts: Vec2[], fill: string) =>
    `<polygon points="${pts.map((q) => `${px(q).x.toFixed(1)},${px(q).y.toFixed(1)}`).join(" ")}" fill="${fill}" stroke="#222" stroke-width="1"/>`;
  // Plate colours as they photograph: FR4 green, clear acrylic over a dark mat, printed PLA.
  const PLATE: Record<string, string> = {
    fr4: "#2f6b3a",
    acrylic: "#6f8796",
    pla: "#d9822b",
    aluminium: "#a7a9ac",
    plywood: "#c49a6c",
  };
  const colour: Record<string, string> = {
    mcu: "#1f6fb2",
    motor_driver: "#b3261e",
    battery: "#3a3a3a",
    regulator: "#2e7d32",
    wheel: "#111",
  };
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#e9e6df"/>`,
    poly(chassis.outline, PLATE[chassis.material] ?? "#9aa7b0"),
    ...parts
      .filter((x) => x.p.mount === "top" || x.c.category === "wheel")
      .map((x) => poly(x.corners, colour[x.c.category] ?? "#777")),
    `<text x="8" y="${H - 8}" font-family="sans-serif" font-size="14" fill="#555">LineLab render (not a photo)</text>`,
    "</svg>",
  ].join("");
  return { widthPx: W, heightPx: H, mmPerPx, outline: silhouette.map(frac), boxes, svg };
}

/** Attach the synthetic camera's boxes to detections (by their chosen component). */
export function withBoxes(
  detections: PhotoDetection[],
  componentOf: (d: PhotoDetection) => string | undefined,
  view: SyntheticTopView,
): PhotoDetection[] {
  return detections.map((d) => {
    const id = componentOf(d);
    const box = id ? view.boxes.get(id) : undefined;
    return box ? { ...d, topBox: box } : d;
  });
}
