import { yawOf } from "@linelab/design-core";
import type { Component, Net, Placement } from "@linelab/schema";

/** Stable colour for a net: conventional colours for power and ground, a palette for signals. */
export function netColor(net: Pick<Net, "name">): string {
  const n = net.name.toUpperCase();
  if (n === "GND" || n.endsWith("GND")) return "#3f3f46";
  if (n.includes("VBAT") || n === "VIN" || n.includes("VM")) return "#dc2626";
  if (/^(5V|3\.3V|3V3|VCC)/.test(n) || n.includes("_REG")) return "#ea580c";
  const palette = [
    "#2563eb",
    "#16a34a",
    "#9333ea",
    "#0891b2",
    "#ca8a04",
    "#db2777",
    "#4f46e5",
    "#059669",
  ];
  let h = 0;
  for (const ch of net.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length] ?? "#2563eb";
}

/**
 * Approximate 3D position (chassis frame, mm) of a pin, for drawing wires. Pins are spread in two
 * rows along the part's long edges on its top face; real header positions are not in the data yet.
 */
export function pinAnchor(p: Placement, c: Component, pinId: string): [number, number, number] {
  const i = Math.max(
    0,
    c.pins.findIndex((q) => q.id === pinId),
  );
  const n = Math.max(1, c.pins.length);
  const d = c.dimensionsMm;
  const perRow = Math.ceil(n / 2);
  const row = i < perRow ? 0 : 1;
  const j = row === 0 ? i : i - perRow;
  let lx = -d.x * 0.45 + ((j + 0.5) * d.x * 0.9) / perRow;
  let ly = (row === 0 ? 1 : -1) * d.y * 0.4;
  let lz = d.z;
  if (c.category === "motor") {
    // Motor terminals at the back of the can.
    lx = -d.x / 2;
    ly = (i % 2 === 0 ? 1 : -1) * d.y * 0.2;
    lz = d.z / 2;
  }
  const yaw = yawOf(p.rotation);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return [
    p.position.x + lx * cos - ly * sin,
    p.position.y + lx * sin + ly * cos,
    p.position.z + lz,
  ];
}
