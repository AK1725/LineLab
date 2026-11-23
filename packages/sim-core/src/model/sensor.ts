import type { Prng } from "../prng.js";
import type { TrackField } from "../track/geometry.js";

export type SensorOutput = "analog" | "digital" | "rc";

/** One reflectance channel, in chassis coordinates (mm). */
export interface SensorChannel {
  xMm: number;
  yMm: number;
  heightMm: number;
  /** Top of the optimal height range for its sensor (signal falls off above it). */
  optimalMaxMm: number;
  output: SensorOutput;
  /** Instance id of the sensor board, and channel number on it (1-based). */
  instanceId: string;
  channel: number;
}

export interface SensorEnv {
  /** Ambient IR reaching the detector, as a fraction of a white surface's reflection. */
  ambient: number;
  /** Gaussian noise standard deviation as a fraction of full scale. */
  noiseStd: number;
  /** Multiplies the reflected signal (twin calibration). */
  gain: number;
  /** Added to the normalised reading (twin calibration). */
  offset: number;
}

/** QTR-RC style sensors: decay time on a white surface and the read timeout (µs). */
export const RC_MIN_US = 60;
export const RC_TIMEOUT_US = 2500;

/** Footprint radius (mm) of an emitter/detector pair at height h: a ~25° half-angle cone plus the
 * spacing of the pair. */
export const footprintRadiusMm = (heightMm: number) => 1.2 + Math.max(0, heightMm) * 0.45;

/** Relative signal vs height: flat inside the optimal range, falling off as the square above it. */
export function heightGain(heightMm: number, optimalMaxMm: number): number {
  const over = Math.max(0, heightMm - optimalMaxMm) / optimalMaxMm;
  return 1 / (1 + over * over);
}

// Sample pattern over the footprint: the centre (weight 1/4) plus six points on a ring at 0.7 r.
const RING = Array.from(
  { length: 6 },
  (_, i) => [Math.cos((i * Math.PI) / 3), Math.sin((i * Math.PI) / 3)] as const,
);

/** [dx, dy, weight] sample points of a footprint of radius r. */
export const footprintPoints = (radiusMm: number): (readonly [number, number, number])[] => [
  [0, 0, 0.25],
  ...RING.map(([c, s]) => [c * radiusMm * 0.7, s * radiusMm * 0.7, 0.125] as const),
];

/** Mean reflectance under the footprint of a sensor at world point (x, y). */
export function footprintReflectance(
  field: TrackField,
  x: number,
  y: number,
  radiusMm: number,
): number {
  return field.meanReflectance(x, y, footprintPoints(radiusMm), radiusMm);
}

/**
 * The value a sketch would read: ADC counts for analog boards (higher = darker, like the QTR-A
 * and most phototransistor boards), 0/1 for comparator boards (1 = dark), and decay time in µs
 * for RC boards. `fraction` is darkness in 0..1 before noise.
 */
export function readChannel(
  ch: SensorChannel,
  reflectance: number,
  env: SensorEnv,
  adcMax: number,
  rng: Prng,
): number {
  const light = heightGain(ch.heightMm, ch.optimalMaxMm) * reflectance * env.gain + env.ambient;
  const dark = Math.max(0, Math.min(1, 1 - light + env.offset + rng.gaussian() * env.noiseStd));
  if (ch.output === "digital") return dark > 0.5 ? 1 : 0;
  if (ch.output === "rc")
    return Math.round(Math.min(RC_TIMEOUT_US, RC_MIN_US + dark * (RC_TIMEOUT_US - RC_MIN_US)));
  return Math.round(dark * adcMax);
}
