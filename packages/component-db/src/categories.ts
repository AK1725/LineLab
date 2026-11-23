import type { Category } from "@linelab/schema";

/** Display order and labels for component categories. */
export const CATEGORY_INFO: readonly { id: Category; label: string; plural: string }[] = [
  { id: "mcu", label: "Microcontroller", plural: "Microcontrollers" },
  { id: "line_sensor", label: "Line sensor", plural: "Line sensors" },
  { id: "motor_driver", label: "Motor driver", plural: "Motor drivers" },
  { id: "motor", label: "Motor", plural: "Motors" },
  { id: "wheel", label: "Wheel", plural: "Wheels" },
  { id: "caster", label: "Caster", plural: "Casters" },
  { id: "battery", label: "Battery", plural: "Batteries" },
  { id: "regulator", label: "Regulator", plural: "Regulators" },
  { id: "sensor", label: "Sensor", plural: "Other sensors" },
  { id: "communication", label: "Wireless", plural: "Wireless" },
  { id: "display", label: "Display", plural: "Displays" },
  { id: "input", label: "Input", plural: "Inputs" },
  { id: "indicator", label: "Indicator", plural: "Indicators" },
  { id: "fan", label: "Fan", plural: "Fans" },
  { id: "esc", label: "ESC", plural: "ESCs" },
  { id: "mechanical", label: "Mechanical", plural: "Mechanical" },
  { id: "misc", label: "Misc", plural: "Misc" },
];

const ORDER = new Map(CATEGORY_INFO.map((c, i) => [c.id, i]));
const LABEL = new Map(CATEGORY_INFO.map((c) => [c.id, c.label]));

export const categoryOrder = (c: Category): number => ORDER.get(c) ?? CATEGORY_INFO.length;
export const categoryLabel = (c: Category): string => LABEL.get(c) ?? c;
