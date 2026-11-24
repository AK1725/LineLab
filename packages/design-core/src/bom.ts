import type { Chassis, Design } from "@linelab/schema";
import { designMassProps } from "./mass.js";
import type { Lookup } from "./placement.js";

export interface BomLine {
  componentId: string;
  name: string;
  category: string;
  quantity: number;
  /** Per unit. */
  massG: number;
  /** From the database, when known (most parts have none yet: never guessed). */
  typicalPriceUsd: number | undefined;
  datasheetUrl: string | undefined;
}

export interface Bom {
  lines: BomLine[];
  /** Chassis plate (from its outline, thickness and material). */
  chassisMassG: number;
  totalMassG: number;
  /** Sum over lines with a known price, and how many lines have none. */
  knownCostUsd: number;
  unpricedLines: number;
}

/** Bill of materials (BLUEPRINT §2.2 J): parts grouped by type, mass and known prices. */
export function bomOf(design: Design, chassis: Chassis | undefined, lookup: Lookup): Bom {
  const by = new Map<string, BomLine>();
  for (const p of design.placements) {
    const c = lookup(p.componentId);
    if (!c) continue;
    const l = by.get(c.id);
    if (l) l.quantity++;
    else
      by.set(c.id, {
        componentId: c.id,
        name: c.name,
        category: c.category,
        quantity: 1,
        massG: c.massG,
        typicalPriceUsd: c.typicalPriceUsd,
        datasheetUrl: c.datasheetUrl,
      });
  }
  const lines = [...by.values()].sort(
    (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  );
  const partsMass = lines.reduce((s, l) => s + l.massG * l.quantity, 0);
  const totalMassG = chassis ? designMassProps(design, chassis, lookup).massG : partsMass;
  return {
    lines,
    chassisMassG: Math.max(0, totalMassG - partsMass),
    totalMassG,
    knownCostUsd: lines.reduce((s, l) => s + (l.typicalPriceUsd ?? 0) * l.quantity, 0),
    unpricedLines: lines.filter((l) => l.typicalPriceUsd === undefined).length,
  };
}

const csvCell = (v: string | number) => {
  const s = String(v);
  // Quote, and defuse spreadsheet formulas (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) || safe !== s ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** CSV with a unit-price column filled from `prices` (user-entered) or the database. */
export function bomCsv(bom: Bom, prices: Record<string, number> = {}): string {
  const rows: (string | number)[][] = [
    [
      "Qty",
      "Part",
      "Category",
      "Unit mass (g)",
      "Unit price (USD)",
      "Line price (USD)",
      "Datasheet",
    ],
  ];
  for (const l of bom.lines) {
    const unit = prices[l.componentId] ?? l.typicalPriceUsd;
    rows.push([
      l.quantity,
      l.name,
      l.category,
      l.massG,
      unit ?? "",
      unit === undefined ? "" : Math.round(unit * l.quantity * 100) / 100,
      l.datasheetUrl ?? "",
    ]);
  }
  rows.push(["", "Chassis plate", "chassis", Math.round(bom.chassisMassG * 10) / 10, "", "", ""]);
  return `${rows.map((r) => r.map(csvCell).join(",")).join("\n")}\n`;
}
