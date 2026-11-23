/**
 * Small geometry kit shared by the generators.
 *
 * Conventions (all generators): units are millimetres, Z is up, +X is the component's "length"
 * axis. A model sits on z = 0 and is centred in X and Y, so it fits inside
 * [-x/2, x/2] × [-y/2, y/2] × [0, z] of the component's `dimensionsMm`.
 */
import type { Group } from "three";
import {
  BoxGeometry,
  DoubleSide,
  FrontSide,
  CylinderGeometry,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  type BufferGeometry,
} from "three";

export interface Dims {
  x: number;
  y: number;
  z: number;
}

/** Named colours. Generators expose a numeric `color` param that indexes `PALETTE_ORDER`. */
export const COLORS = {
  black: 0x1b1d21,
  white: 0xe9eaec,
  red: 0xb3262e,
  green: 0x1d7a3a,
  blue: 0x1f5fa8,
  yellow: 0xe2b417,
  grey: 0x6b7280,
  orange: 0xd9681a,
  silver: 0xb8bcc2,
  brass: 0xc9a245,
  teal: 0x00878f,
  purple: 0x5b2a86,
  gold: 0xd4af37,
  copper: 0xb06a3b,
} as const;
export type ColorName = keyof typeof COLORS;

/** Index order for numeric `color` / `pcbColor` params. Append only: data files depend on it. */
export const PALETTE_ORDER: readonly ColorName[] = [
  "black",
  "white",
  "red",
  "green",
  "blue",
  "yellow",
  "grey",
  "orange",
  "silver",
  "brass",
  "teal",
  "purple",
];

export function paletteColor(index: number): number {
  const name = PALETTE_ORDER[index];
  if (name === undefined) throw new Error(`Colour index ${index} is outside the palette.`);
  return COLORS[name];
}

const materialCache = new Map<string, MeshStandardMaterial>();

export function material(
  color: number,
  opts: { metal?: boolean; rough?: number; doubleSided?: boolean } = {},
) {
  const key = `${color}:${opts.metal === true ? 1 : 0}:${opts.rough ?? 0.6}:${opts.doubleSided === true ? 2 : 1}`;
  let m = materialCache.get(key);
  if (m === undefined) {
    m = new MeshStandardMaterial({
      color,
      metalness: opts.metal === true ? 0.85 : 0.05,
      roughness: opts.rough ?? (opts.metal === true ? 0.35 : 0.6),
      // Open-ended shells (fan ducts) must render their inside too.
      side: opts.doubleSided === true ? DoubleSide : FrontSide,
    });
    materialCache.set(key, m);
  }
  return m;
}

function add(
  group: Group,
  geometry: BufferGeometry,
  mat: MeshStandardMaterial,
  name: string,
): Mesh {
  const mesh = new Mesh(geometry, mat);
  mesh.name = name;
  group.add(mesh);
  return mesh;
}

/** Axis-aligned box with its centre at (cx, cy) and its bottom face at z0. */
export function box(
  group: Group,
  size: Dims,
  at: { cx: number; cy: number; z0: number },
  mat: MeshStandardMaterial,
  name = "box",
): Mesh {
  const mesh = add(group, new BoxGeometry(size.x, size.y, size.z), mat, name);
  mesh.position.set(at.cx, at.cy, at.z0 + size.z / 2);
  return mesh;
}

/**
 * Cylinder along an axis. `center` is the geometric centre of the cylinder.
 * `segments = 6` gives a hexagonal prism (standoffs).
 */
export function cylinder(
  group: Group,
  opts: {
    radius: number;
    length: number;
    axis: "x" | "y" | "z";
    center: { x: number; y: number; z: number };
    radiusTop?: number;
    segments?: number;
    openEnded?: boolean;
  },
  mat: MeshStandardMaterial,
  name = "cylinder",
): Mesh {
  const geometry = new CylinderGeometry(
    opts.radiusTop ?? opts.radius,
    opts.radius,
    opts.length,
    opts.segments ?? 32,
    1,
    opts.openEnded ?? false,
  );
  // three.js cylinders run along +Y; rotate onto the requested axis.
  if (opts.axis === "x") geometry.rotateZ(-Math.PI / 2);
  if (opts.axis === "z") geometry.rotateX(Math.PI / 2);
  const mesh = add(group, geometry, mat, name);
  mesh.position.set(opts.center.x, opts.center.y, opts.center.z);
  return mesh;
}

export function sphere(
  group: Group,
  opts: { radius: number; center: { x: number; y: number; z: number }; hemisphere?: boolean },
  mat: MeshStandardMaterial,
  name = "sphere",
): Mesh {
  const geometry =
    opts.hemisphere === true
      ? new SphereGeometry(opts.radius, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2)
      : new SphereGeometry(opts.radius, 24, 16);
  const mesh = add(group, geometry, mat, name);
  mesh.position.set(opts.center.x, opts.center.y, opts.center.z);
  return mesh;
}

/** 2.54 mm pin header: black plastic strip with gold pins standing up from z0. */
export function headerStrip(
  group: Group,
  opts: { count: number; rows: number; cx: number; cy: number; z0: number; maxHeight: number },
) {
  const pitch = 2.54;
  const plastic = Math.min(2.5, opts.maxHeight);
  const pinLen = Math.max(0, Math.min(6, opts.maxHeight - plastic));
  const length = opts.count * pitch;
  box(
    group,
    { x: length, y: opts.rows * pitch, z: plastic },
    { cx: opts.cx, cy: opts.cy, z0: opts.z0 },
    material(COLORS.black),
    "header-plastic",
  );
  if (pinLen <= 0) return;
  const gold = material(COLORS.gold, { metal: true });
  for (let r = 0; r < opts.rows; r++) {
    for (let i = 0; i < opts.count; i++) {
      box(
        group,
        { x: 0.64, y: 0.64, z: pinLen },
        {
          cx: opts.cx - length / 2 + pitch / 2 + i * pitch,
          cy: opts.cy - ((opts.rows - 1) * pitch) / 2 + r * pitch,
          z0: opts.z0 + plastic,
        },
        gold,
        "header-pin",
      );
    }
  }
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
