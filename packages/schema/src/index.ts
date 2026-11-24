import { Chassis } from "./chassis.js";
import { Component } from "./component.js";
import { Design } from "./design.js";
import { Finding } from "./finding.js";
import { RunTrace } from "./run.js";
import { Track } from "./track.js";

export * from "./primitives.js";
export * from "./board.js";
export * from "./component.js";
export * from "./chassis.js";
export * from "./design.js";
export * from "./command.js";
export * from "./track.js";
export * from "./run.js";
export * from "./finding.js";
export * from "./firmware.js";
export * from "./telemetry.js";
export * from "./photo.js";
export * from "./gallery.js";
export { formatIssues } from "./format.js";

/** Top-level document schemas, exported as JSON Schema files for editors and external tools. */
export const documentSchemas = {
  component: Component,
  chassis: Chassis,
  design: Design,
  track: Track,
  "run-trace": RunTrace,
  finding: Finding,
} as const;

export type DocumentKind = keyof typeof documentSchemas;
