import type { Polygon, Vec2 } from "@linelab/schema";
import { circlePolygon, round2 } from "../polygon.js";
import { classifyLoops, type ImportedOutline } from "./dxf.js";

const attr = (tag: string, name: string): string | undefined => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? (m[2] ?? m[3]) : undefined;
};

/** Millimetres per SVG user unit, from width/height + viewBox (defaults to 1). */
function unitScale(svgTag: string): number {
  const width = attr(svgTag, "width");
  const viewBox = attr(svgTag, "viewBox");
  if (!width || !viewBox) return 1;
  const m = /^([\d.]+)\s*(mm|cm|in|px|pt)?$/.exec(width.trim());
  const vb = viewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (!m || vb.length !== 4 || !vb[2]) return 1;
  const toMm = { mm: 1, cm: 10, in: 25.4, px: 25.4 / 96, pt: 25.4 / 72 }[(m[2] ?? "px") as "mm"];
  return (Number(m[1]) * toMm) / vb[2];
}

/** Path data → closed loops. Supports M L H V C S Q T Z (absolute and relative); arcs become straight lines. */
export function pathToLoops(d: string): Vec2[][] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? [];
  const loops: Vec2[][] = [];
  let cur: Vec2[] = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let cmd = "";
  let lastCtrl: Vec2 | undefined;
  let i = 0;
  const n = () => Number(tokens[i++]);
  const isNum = () => i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i] ?? "");
  const cubic = (p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2) => {
    for (let k = 1; k <= 8; k++) {
      const t = k / 8;
      const u = 1 - t;
      cur.push({
        x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
        y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
      });
    }
  };
  const close = () => {
    if (cur.length >= 3) loops.push(cur);
    cur = [];
  };
  while (i < tokens.length) {
    if (!isNum()) cmd = tokens[i++] ?? "";
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    if (C === "Z") {
      x = sx;
      y = sy;
      close();
      continue;
    }
    if (!isNum()) break;
    switch (C) {
      case "M":
        close();
        x = ox + n();
        y = oy + n();
        sx = x;
        sy = y;
        cur.push({ x, y });
        cmd = rel ? "l" : "L";
        break;
      case "L":
        x = ox + n();
        y = oy + n();
        cur.push({ x, y });
        break;
      case "H":
        x = ox + n();
        cur.push({ x, y });
        break;
      case "V":
        y = oy + n();
        cur.push({ x, y });
        break;
      case "C": {
        const p1 = { x: ox + n(), y: oy + n() };
        const p2 = { x: ox + n(), y: oy + n() };
        const p3 = { x: ox + n(), y: oy + n() };
        cubic({ x, y }, p1, p2, p3);
        lastCtrl = p2;
        x = p3.x;
        y = p3.y;
        continue;
      }
      case "S": {
        const p1 = lastCtrl ? { x: 2 * x - lastCtrl.x, y: 2 * y - lastCtrl.y } : { x, y };
        const p2 = { x: ox + n(), y: oy + n() };
        const p3 = { x: ox + n(), y: oy + n() };
        cubic({ x, y }, p1, p2, p3);
        lastCtrl = p2;
        x = p3.x;
        y = p3.y;
        continue;
      }
      case "Q":
      case "T": {
        const q =
          C === "Q"
            ? { x: ox + n(), y: oy + n() }
            : lastCtrl
              ? { x: 2 * x - lastCtrl.x, y: 2 * y - lastCtrl.y }
              : { x, y };
        const p3 = { x: ox + n(), y: oy + n() };
        cubic(
          { x, y },
          { x: x + (2 / 3) * (q.x - x), y: y + (2 / 3) * (q.y - y) },
          { x: p3.x + (2 / 3) * (q.x - p3.x), y: p3.y + (2 / 3) * (q.y - p3.y) },
          p3,
        );
        lastCtrl = q;
        x = p3.x;
        y = p3.y;
        continue;
      }
      case "A":
        n();
        n();
        n();
        n();
        n();
        x = ox + n();
        y = oy + n();
        cur.push({ x, y });
        break;
      default:
        i++;
    }
    lastCtrl = undefined;
  }
  close();
  return loops;
}

/**
 * Reads a top-view chassis drawing. Supported: path, polygon, polyline, rect, circle, ellipse.
 * Units come from the root width + viewBox (draw in mm for best results). SVG's Y axis points
 * down, so Y is flipped; the result is centred on the outline's bounding box. `transform`
 * attributes are not applied.
 */
export function parseSvgOutline(svg: string): ImportedOutline {
  const warnings: string[] = [];
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
  const s = unitScale(root);
  if (/\stransform\s*=/.test(svg))
    warnings.push(
      "SVG transforms are ignored; flatten them in your editor if the shape looks wrong.",
    );
  const loops: Vec2[][] = [];
  const holes: Vec2[] = [];
  let holeD: number | undefined;
  const num = (tag: string, name: string) => Number(attr(tag, name) ?? "0");

  for (const tag of svg.match(/<(path|polygon|polyline|rect|circle|ellipse)\b[^>]*>/gi) ?? []) {
    const kind = (/^<(\w+)/.exec(tag)?.[1] ?? "").toLowerCase();
    if (kind === "path") loops.push(...pathToLoops(attr(tag, "d") ?? ""));
    else if (kind === "polygon" || kind === "polyline") {
      const v = (attr(tag, "points") ?? "")
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      const pts: Vec2[] = [];
      for (let k = 0; k + 1 < v.length; k += 2)
        pts.push({ x: v[k] as number, y: v[k + 1] as number });
      loops.push(pts);
    } else if (kind === "rect") {
      const x = num(tag, "x");
      const y = num(tag, "y");
      const w = num(tag, "width");
      const h = num(tag, "height");
      loops.push([
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ]);
    } else {
      const c = { x: num(tag, "cx"), y: num(tag, "cy") };
      const rx = kind === "circle" ? num(tag, "r") : num(tag, "rx");
      const ry = kind === "circle" ? rx : num(tag, "ry");
      if (rx * 2 * s <= 6 && Math.abs(rx - ry) < 1e-6) {
        holes.push(c);
        holeD = round2(rx * 2 * s);
      } else
        loops.push(
          circlePolygon({ x: 0, y: 0 }, 1, 32).map((p) => ({
            x: c.x + p.x * rx,
            y: c.y + p.y * ry,
          })),
        );
    }
  }

  // Scale to mm, flip Y, then centre on the largest loop's bounding box.
  const toMm = (p: Vec2) => ({ x: p.x * s, y: -p.y * s });
  const mmLoops: Polygon[] = loops.map((l) => l.map(toMm));
  const result = classifyLoops(mmLoops, holes.map(toMm), holeD, warnings);
  const xs = result.outline.map((p) => p.x);
  const ys = result.outline.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const shift = (p: Vec2) => ({ x: round2(p.x - cx), y: round2(p.y - cy) });
  return {
    ...result,
    outline: result.outline.map(shift),
    cutouts: result.cutouts.map((c) => c.map(shift)),
    holes: result.holes.map(shift),
  };
}
