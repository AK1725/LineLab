import type { TwinParams } from "@linelab/schema";
import type { RobotModel } from "@linelab/sim-core";

export type TwinKey = Exclude<keyof TwinParams, "calibratedAt">;

export interface TwinParamSpec {
  key: TwinKey;
  label: string;
  unit: string;
  lo: number;
  hi: number;
  /** The value the simulator uses when the parameter isn't fitted. */
  nominal: (robot: RobotModel) => number;
}

/** What calibration can fit, with search bounds (wide enough for cheap parts, BLUEPRINT §6.1). */
export const TWIN_PARAMS: readonly TwinParamSpec[] = [
  {
    key: "frictionMu",
    label: "Tyre friction μ",
    unit: "",
    lo: 0.3,
    hi: 1.5,
    nominal: (r) => r.wheels[0].mu,
  },
  {
    key: "motorKtScaleLeft",
    label: "Left motor strength",
    unit: "×",
    lo: 0.6,
    hi: 1.4,
    nominal: () => 1,
  },
  {
    key: "motorKtScaleRight",
    label: "Right motor strength",
    unit: "×",
    lo: 0.6,
    hi: 1.4,
    nominal: () => 1,
  },
  {
    key: "driverDropV",
    label: "Driver voltage drop",
    unit: "V",
    lo: 0,
    hi: 3,
    nominal: (r) => r.driver.dropV,
  },
  { key: "sensorGain", label: "Sensor gain", unit: "×", lo: 0.4, hi: 1.4, nominal: () => 1 },
  {
    key: "sensorOffset",
    label: "Sensor offset",
    unit: "of full scale",
    lo: -0.2,
    hi: 0.2,
    nominal: () => 0,
  },
  {
    key: "sensorNoiseStd",
    label: "Sensor noise",
    unit: "of full scale",
    lo: 0,
    hi: 0.05,
    nominal: () => 0.005,
  },
  { key: "latencyMs", label: "Sensor latency", unit: "ms", lo: 0, hi: 25, nominal: () => 0 },
];

export const specOf = (key: TwinKey): TwinParamSpec => {
  const s = TWIN_PARAMS.find((p) => p.key === key);
  if (!s) throw new Error(`unknown twin parameter ${key}`);
  return s;
};

/** Physical value ↔ the optimiser's [0, 1] coordinate. */
export const toUnit = (s: TwinParamSpec, v: number) => (v - s.lo) / (s.hi - s.lo);
export const fromUnit = (s: TwinParamSpec, u: number) =>
  s.lo + Math.min(1, Math.max(0, u)) * (s.hi - s.lo);

/** Twin parameters for unit coordinates over `keys`, rounded to sensible precision. */
export function twinFromUnit(keys: readonly TwinKey[], u: readonly number[]): TwinParams {
  const out: TwinParams = {};
  keys.forEach((k, i) => {
    const v = fromUnit(specOf(k), u[i] ?? 0);
    out[k] = Math.round(v * 1e4) / 1e4;
  });
  return out;
}
