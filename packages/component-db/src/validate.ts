import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { formatIssues } from "@linelab/schema";
import type { z } from "zod";

export interface ValidationTarget {
  /** Human label used in the report, e.g. "components". */
  label: string;
  dir: string;
  schema: z.ZodType<{ id: string }>;
}

export interface ValidationProblem {
  file: string;
  message: string;
}

export interface ValidationReport {
  checked: number;
  problems: ValidationProblem[];
}

function listJsonFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listJsonFiles(full);
    return name.endsWith(".json") ? [full] : [];
  });
}

/**
 * Validates every `*.json` file under each target directory:
 * - parses as JSON and passes the Zod schema (including cross-field refinements)
 * - file name equals `<id>.json`, so ids are greppable and unique per folder
 * - ids are unique across all targets
 */
export function validateTargets(
  targets: ValidationTarget[],
  rootForReport: string,
): ValidationReport {
  const problems: ValidationProblem[] = [];
  const idToFile = new Map<string, string>();
  let checked = 0;

  for (const target of targets) {
    for (const file of listJsonFiles(target.dir)) {
      checked++;
      const shown = relative(rootForReport, file);
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(file, "utf8"));
      } catch (err) {
        problems.push({ file: shown, message: `invalid JSON: ${(err as Error).message}` });
        continue;
      }

      const parsed = target.schema.safeParse(raw);
      if (!parsed.success) {
        for (const msg of formatIssues(parsed.error)) problems.push({ file: shown, message: msg });
        continue;
      }

      const { id } = parsed.data;
      if (basename(file) !== `${id}.json`) {
        problems.push({ file: shown, message: `file name must be "${id}.json" to match its id` });
      }
      const other = idToFile.get(id);
      if (other !== undefined) {
        problems.push({ file: shown, message: `duplicate id "${id}" (also in ${other})` });
      } else {
        idToFile.set(id, shown);
      }
    }
  }
  return { checked, problems };
}
