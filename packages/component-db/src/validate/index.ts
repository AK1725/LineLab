/** Node-only validation helpers (file system + three.js model checks). */
export { validateTargets } from "./files.js";
export type { ValidationProblem, ValidationReport, ValidationTarget } from "./files.js";
export { checkCatalog, checkComponent, type CatalogProblem } from "./checks.js";
