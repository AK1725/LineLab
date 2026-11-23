import { Prng } from "../prng.js";

/** Everything Monte Carlo randomises. `NOMINAL` is the datasheet robot on a clean track. */
export interface Variation {
  /** Multiplies tyre μ (dusty vs fresh vinyl). */
  frictionScale: number;
  /** Sensor noise, fraction of full scale. */
  sensorNoiseStd: number;
  /** Ambient IR, fraction of a white surface's reflection. */
  ambient: number;
  /** Battery state of charge at the start. */
  soc: number;
  /** Motor constant mismatch, left and right (gearbox and magnet variation). */
  ktScaleLeft: number;
  ktScaleRight: number;
  /** Start-pose jitter (mm, mm, rad). */
  startDxMm: number;
  startDyMm: number;
  startDHeadingRad: number;
}

export const NOMINAL: Variation = {
  frictionScale: 1,
  sensorNoiseStd: 0.005,
  ambient: 0.02,
  soc: 0.9,
  ktScaleLeft: 1,
  ktScaleRight: 1,
  startDxMm: 0,
  startDyMm: 0,
  startDHeadingRad: 0,
};

/** Ranges from BLUEPRINT §5.6: friction ±20 %, motor mismatch ±5 %, plus noise, light, SoC, pose. */
export function randomVariation(seed: number): Variation {
  const r = new Prng(seed ^ 0x6d2b79f5);
  return {
    frictionScale: r.range(0.8, 1.2),
    sensorNoiseStd: r.range(0.003, 0.015),
    ambient: r.range(0, 0.08),
    soc: r.range(0.6, 1),
    ktScaleLeft: r.range(0.95, 1.05),
    ktScaleRight: r.range(0.95, 1.05),
    startDxMm: r.range(-3, 3),
    startDyMm: r.range(-3, 3),
    startDHeadingRad: r.range(-0.05, 0.05),
  };
}
