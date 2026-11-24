/**
 * @linelab/agent: the AI debug agent (BLUEPRINT §5.8). A Messages API tool loop over a
 * deterministic workbench (the user's robot, track and seeds), with the patch verification gate
 * enforced in code: only patches that compile and measurably fix something without regressions
 * are ever shown.
 */
export * from "./config.js";
export * from "./compiler.js";
export * from "./model.js";
export * from "./patch.js";
export * from "./workbench.js";
export * from "./gate.js";
export * from "./knowledge.js";
export * from "./prompt.js";
export * from "./tools.js";
export * from "./session.js";
