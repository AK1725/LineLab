import type { Design } from "@linelab/schema";
import type { Lookup } from "../placement.js";

const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** KiCad reference designator from an instance id: "motor-driver1" → "MOTOR_DRIVER1". */
export const kicadRef = (instanceId: string) =>
  instanceId.toUpperCase().replace(/[^A-Z0-9]+/g, "_");

/**
 * KiCad netlist (s-expression, format "E") of the design's parts and nets, for importing into
 * KiCad's PCB editor. Footprints are left empty: assign them in KiCad.
 */
export function designToKicadNetlist(
  design: Design,
  lookup: Lookup,
  date = new Date().toISOString(),
): string {
  const lines: string[] = [];
  lines.push('(export (version "E")');
  lines.push(
    `  (design (source ${q(`${design.name}.linelab.json`)}) (date ${q(date)}) (tool "LineLab"))`,
  );
  lines.push("  (components");
  for (const p of design.placements) {
    const c = lookup(p.componentId);
    lines.push(
      `    (comp (ref ${q(kicadRef(p.instanceId))}) (value ${q(c?.name ?? p.componentId)}) (footprint "") (fields (field (name "LineLab") ${q(p.componentId)})))`,
    );
  }
  lines.push("  )");
  lines.push("  (nets");
  design.netlist.forEach((n, i) => {
    const nodes = n.connections
      .map((e) => `(node (ref ${q(kicadRef(e.instanceId))}) (pin ${q(e.pinId)}))`)
      .join(" ");
    lines.push(`    (net (code ${q(String(i + 1))}) (name ${q(n.name)}) ${nodes})`);
  });
  lines.push("  )");
  lines.push(")");
  return `${lines.join("\n")}\n`;
}
