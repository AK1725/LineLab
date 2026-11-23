/**
 * @linelab/compiler: the sandboxed firmware compile service (see README.md and ADR 0007).
 * The server entry point is `server.ts`; these exports let scripts and tests compile directly.
 */
export { compile, tierOf, EMULATED_FQBN, type CompilerConfig } from "./compile.js";
export { configFromEnv } from "./config.js";
export { runJob, DEFAULT_LIMITS, type JobLimits, type JobResult } from "./sandbox.js";
export * from "./parse.js";
