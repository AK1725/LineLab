import type { z } from "zod";

/** Human-readable one-line-per-issue rendering of a Zod error, e.g. `pins.3.id: Duplicate pin id "VCC".` */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
  });
}
