import type { Component } from "@linelab/schema";

type MotorSpec = Extract<Component["electrical"], { kind: "motor" }>;

/** Gravity used to convert kg·cm datasheet torques (N/kg). */
export const G_MPS2 = 9.80665;

/**
 * Assumed mechanical time constant of small brushed gearmotors at no load (10–30 ms is typical for
 * N20/TT-class motors). Datasheets rarely give rotor inertia, so it is derived from this.
 */
export const MECH_TIME_CONSTANT_S = 0.015;

/** DC motor at the gearbox output shaft. Inductance is ignored (its time constant is < 1 ms). */
export interface MotorParams {
  resistanceOhm: number;
  /** Output torque per amp above no-load current (includes gear ratio and gearbox efficiency). */
  ktNmPerA: number;
  /** Back-EMF per output rad/s. */
  keVsPerRad: number;
  noLoadCurrentA: number;
  /** Rotor inertia reflected to the output shaft. */
  inertiaKgM2: number;
  noLoadSpeedRadS: number;
  stallTorqueNm: number;
}

/**
 * Motor constants from the four datasheet numbers (rated voltage, no-load speed and current,
 * stall current and torque): R = V/I_stall, Kt = τ_stall/(I_stall − I_0), Ke = (V − I_0 R)/ω_0.
 * `ktScale` models unit-to-unit mismatch (Monte Carlo) or a fitted twin parameter.
 */
export function motorParams(spec: MotorSpec, ktScale = 1): MotorParams {
  const resistanceOhm = spec.ratedVoltageV / spec.stallCurrentA;
  const stallTorqueNm = (spec.stallTorqueKgCm / 100) * G_MPS2;
  const noLoadSpeedRadS = (spec.noLoadRpm * 2 * Math.PI) / 60;
  const ktNmPerA = (stallTorqueNm / (spec.stallCurrentA - spec.noLoadCurrentA)) * ktScale;
  const keVsPerRad =
    ((spec.ratedVoltageV - spec.noLoadCurrentA * resistanceOhm) / noLoadSpeedRadS) * ktScale;
  return {
    resistanceOhm,
    ktNmPerA,
    keVsPerRad,
    noLoadCurrentA: spec.noLoadCurrentA,
    inertiaKgM2: (MECH_TIME_CONSTANT_S * ktNmPerA * keVsPerRad) / resistanceOhm,
    noLoadSpeedRadS,
    stallTorqueNm,
  };
}

/** Speed (rad/s) below which friction is smoothed, so a stalled motor doesn't chatter. */
const FRICTION_SMOOTH_RAD_S = 0.5;

/**
 * Current and output torque for terminal voltage `voltageV` at output speed `speedRadS`,
 * with the current limited to ±`limitA` (driver protection or supply limit).
 */
export function motorStep(
  m: MotorParams,
  voltageV: number,
  speedRadS: number,
  limitA: number,
): { currentA: number; torqueNm: number } {
  const raw = (voltageV - m.keVsPerRad * speedRadS) / m.resistanceOhm;
  const currentA = Math.max(-limitA, Math.min(limitA, raw));
  const friction = m.ktNmPerA * m.noLoadCurrentA * Math.tanh(speedRadS / FRICTION_SMOOTH_RAD_S);
  return { currentA, torqueNm: m.ktNmPerA * currentA - friction };
}
