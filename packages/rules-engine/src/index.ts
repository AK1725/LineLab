import type { Lookup } from "@linelab/design-core";
import type { Chassis, Design, Finding } from "@linelab/schema";
import { buildCircuit } from "./circuit.js";
import type { Rule } from "./rule.js";
import { ELECTRICAL_RULES } from "./rules/electrical.js";
import { MECHANICAL_RULES } from "./rules/mechanical.js";

export { buildCircuit, type Circuit, type NetInfo, type PartRef, type PinRef } from "./circuit.js";
export type { Rule } from "./rule.js";
export { ELECTRICAL_RULES, MECHANICAL_RULES };

export const RULES: readonly Rule[] = [...ELECTRICAL_RULES, ...MECHANICAL_RULES];

const ORDER = { error: 0, warning: 1, tip: 2 } as const;

/**
 * Runs every rule against a design. Pure and fast enough to run on every edit (well under 50 ms
 * for a typical robot). A rule that throws is reported as a finding instead of breaking the editor.
 */
export function runRules(
  design: Design,
  chassis: Chassis,
  lookup: Lookup,
  rules: readonly Rule[] = RULES,
): Finding[] {
  const circuit = buildCircuit(design, chassis, lookup);
  const out: Finding[] = [];
  for (const rule of rules) {
    try {
      out.push(...rule.check(circuit));
    } catch (err) {
      out.push({
        id: "internal.rule-crashed",
        severity: "tip",
        message: `Check "${rule.id}" could not run.`,
        explanation: (err as Error).message,
        affected: [],
      });
    }
  }
  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.id.localeCompare(b.id));
}
