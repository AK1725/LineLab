import type { Finding, FindingSeverity } from "@linelab/schema";
import type { Circuit } from "./circuit.js";

export interface Rule {
  /** Stable id, also the Finding id, e.g. `elec.missing-common-ground`. */
  id: string;
  category: "electrical" | "mechanical";
  /** Default severity of this rule's findings. */
  severity: FindingSeverity;
  title: string;
  check: (c: Circuit) => Finding[];
}
