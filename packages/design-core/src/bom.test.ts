import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getChassis, getComponent } from "@linelab/component-db";
import { Design } from "@linelab/schema";
import { describe, expect, it } from "vitest";
import { bomCsv, bomOf } from "./bom.js";
import { resolveChassis } from "./placement.js";

const design = Design.parse(
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "..", "..", "sim-core", "fixtures", "reference.design.json"),
      "utf8",
    ),
  ),
);

describe("bill of materials", () => {
  it("groups identical parts, adds the chassis to the mass, and sums only the prices the database has", () => {
    const bom = bomOf(design, resolveChassis(design, getChassis), getComponent);
    const motors = bom.lines.find((l) => l.category === "motor");
    expect(motors?.quantity).toBe(2);
    expect(bom.lines.reduce((s, l) => s + l.quantity, 0)).toBe(design.placements.length);
    expect(bom.chassisMassG).toBeGreaterThan(5);
    expect(bom.totalMassG).toBeCloseTo(
      bom.lines.reduce((s, l) => s + l.massG * l.quantity, 0) + bom.chassisMassG,
      6,
    );
    expect(bom.unpricedLines).toBe(bom.lines.filter((l) => l.typicalPriceUsd === undefined).length);
    expect(bom.knownCostUsd).toBeCloseTo(
      bom.lines.reduce((s, l) => s + (l.typicalPriceUsd ?? 0) * l.quantity, 0),
      6,
    );
  });

  it("exports CSV with user prices and defuses formula injection", () => {
    const bom = bomOf(design, undefined, getComponent);
    const first = bom.lines[0];
    if (!first) throw new Error("empty");
    const csv = bomCsv(
      { ...bom, lines: [{ ...first, name: "=HYPERLINK(evil)" }, ...bom.lines.slice(1)] },
      { [first.componentId]: 2.5 },
    );
    expect(csv.split("\n")[0]).toBe(
      "Qty,Part,Category,Unit mass (g),Unit price (USD),Line price (USD),Datasheet",
    );
    expect(csv).toContain(`"'=HYPERLINK(evil)"`);
    expect(csv).toContain(`,2.5,${String(2.5 * first.quantity)},`);
  });
});
