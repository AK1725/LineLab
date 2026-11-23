/**
 * @linelab/sim-core: deterministic simulation (no DOM, no wall clock, no Math.random).
 * Track model (Phase 4); robot physics, sensors, controllers and Monte Carlo (Phase 5).
 */
export * from "./track/geometry.js";
export * from "./track/builder.js";
export * from "./track/validate.js";
export * from "./prng.js";
export * from "./model/motor.js";
export * from "./model/battery.js";
export * from "./model/sensor.js";
export * from "./model/robot.js";
export * from "./sim/controller.js";
export * from "./sim/variation.js";
export * from "./sim/hash.js";
export * from "./sim/simulation.js";
export * from "./sim/run.js";
