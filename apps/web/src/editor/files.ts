"use client";

import { getChassis } from "@linelab/component-db";
import { resolveChassis } from "@linelab/design-core";
import { Design, formatIssues } from "@linelab/schema";

export function download(filename: string, data: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "robot";

/** Parses and validates an exported design file; the chassis must be known or embedded. */
export function parseDesignFile(
  text: string,
): { ok: true; design: Design } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file is not valid JSON." };
  }
  const parsed = Design.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      error: `Not a LineLab design: ${formatIssues(parsed.error).slice(0, 3).join("; ")}`,
    };
  if (!resolveChassis(parsed.data, getChassis))
    return { ok: false, error: "The design uses a chassis template this version doesn't have." };
  return { ok: true, design: parsed.data };
}

export function exportDesign(design: Design): string {
  return `${JSON.stringify({ $schema: "https://linelab.dev/schema/design.schema.json", ...design }, null, 2)}\n`;
}
