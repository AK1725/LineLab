import type { Component } from "@linelab/schema";

type BatterySpec = Extract<Component["electrical"], { kind: "battery" }>;

/**
 * Typical open-circuit voltage curves, as a fraction of the way from cutoff to full voltage,
 * sampled at state of charge 0, 0.05, 0.1, 0.2, 0.4, 0.6, 0.8, 0.9, 1. Shapes from common
 * discharge curves at low C-rate (LiPo knee near empty, flat LiFePO4 and NiMH plateaus).
 */
const SOC_POINTS = [0, 0.05, 0.1, 0.2, 0.4, 0.6, 0.8, 0.9, 1];
const OCV_CURVES: Record<BatterySpec["chemistry"], number[]> = {
  lipo: [0, 0.25, 0.38, 0.5, 0.6, 0.7, 0.82, 0.9, 1],
  "li-ion": [0, 0.22, 0.35, 0.47, 0.58, 0.69, 0.81, 0.9, 1],
  lifepo4: [0, 0.45, 0.6, 0.68, 0.71, 0.74, 0.78, 0.85, 1],
  nimh: [0, 0.4, 0.55, 0.62, 0.67, 0.72, 0.78, 0.85, 1],
  alkaline: [0, 0.2, 0.32, 0.45, 0.57, 0.67, 0.79, 0.88, 1],
};

export function openCircuitVoltage(spec: BatterySpec, soc: number): number {
  const curve = OCV_CURVES[spec.chemistry];
  const s = Math.max(0, Math.min(1, soc));
  let i = 1;
  while (i < SOC_POINTS.length - 1 && (SOC_POINTS[i] as number) < s) i++;
  const s0 = SOC_POINTS[i - 1] as number;
  const s1 = SOC_POINTS[i] as number;
  const f0 = curve[i - 1] as number;
  const f1 = curve[i] as number;
  const f = f0 + ((f1 - f0) * (s - s0)) / (s1 - s0);
  return spec.cutoffVoltageV + (spec.fullVoltageV - spec.cutoffVoltageV) * f;
}

/** Battery state: SoC falls with drawn charge; terminal voltage sags with current. */
export class Battery {
  soc: number;
  private readonly capacityC: number;
  private readonly rOhm: number;

  constructor(
    readonly spec: BatterySpec,
    initialSoc: number,
  ) {
    this.soc = initialSoc;
    this.capacityC = (spec.capacitymAh / 1000) * 3600;
    this.rOhm = spec.internalResistanceMilliohm / 1000;
  }

  /** Terminal voltage while delivering `currentA` (negative = charging). */
  terminalVoltage(currentA: number): number {
    return Math.max(0, openCircuitVoltage(this.spec, this.soc) - currentA * this.rOhm);
  }

  draw(currentA: number, dtS: number): void {
    this.soc = Math.max(0, Math.min(1, this.soc - (currentA * dtS) / this.capacityC));
  }
}
