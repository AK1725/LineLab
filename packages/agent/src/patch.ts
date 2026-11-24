/**
 * Unified diffs: a strict applier (a patch counts only if every hunk's context and removed lines
 * match the file exactly, possibly at a shifted position) and a generator for showing changes.
 */

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Lines with their prefix: " " context, "-" removed, "+" added. */
  lines: string[];
}

export type ApplyResult = { ok: true; text: string } | { ok: false; error: string };

/** Hunks of a unified diff (file headers and `\ No newline` markers are ignored). */
export function parseUnifiedDiff(diff: string): Hunk[] {
  const hunks: Hunk[] = [];
  let cur: Hunk | undefined;
  const rows = diff.replace(/\r\n/g, "\n").split("\n");
  if (rows.at(-1) === "") rows.pop(); // the diff's own final newline
  for (const raw of rows) {
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (h) {
      cur = {
        oldStart: Number(h[1]),
        oldLines: h[2] === undefined ? 1 : Number(h[2]),
        newStart: Number(h[3]),
        newLines: h[4] === undefined ? 1 : Number(h[4]),
        lines: [],
      };
      hunks.push(cur);
      continue;
    }
    if (!cur || raw.startsWith("\\")) continue;
    if (
      raw.startsWith("---") ||
      raw.startsWith("+++") ||
      raw.startsWith("diff ") ||
      raw.startsWith("index ")
    )
      continue;
    if (raw.startsWith(" ") || raw.startsWith("-") || raw.startsWith("+")) cur.lines.push(raw);
    else if (raw === "") cur.lines.push(" "); // an empty context line whose leading space was stripped
  }
  return hunks;
}

const MAX_OFFSET = 60;

/** Apply a unified diff. Every hunk must match exactly (allowing a shift of up to 60 lines). */
export function applyUnifiedDiff(source: string, diff: string): ApplyResult {
  const hunks = parseUnifiedDiff(diff);
  if (hunks.length === 0)
    return {
      ok: false,
      error: "The patch has no hunks (expected a unified diff with @@ headers).",
    };
  const trailingNewline = source.endsWith("\n");
  const lines = source.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const out: string[] = [];
  let pos = 0; // next unconsumed index in `lines`
  for (const [k, h] of hunks.entries()) {
    const old = h.lines.filter((l) => !l.startsWith("+")).map((l) => l.slice(1));
    const repl = h.lines.filter((l) => !l.startsWith("-")).map((l) => l.slice(1));
    const want = Math.max(0, h.oldStart - 1);
    const matchesAt = (i: number) =>
      i >= pos && i + old.length <= lines.length && old.every((l, j) => lines[i + j] === l);
    let at = -1;
    for (let d = 0; d <= MAX_OFFSET && at < 0; d++) {
      if (matchesAt(want + d)) at = want + d;
      else if (d > 0 && matchesAt(want - d)) at = want - d;
    }
    if (at < 0) {
      const first = old.find((l) => l.trim() !== "") ?? old[0] ?? "";
      return {
        ok: false,
        error: `Hunk ${String(k + 1)} (at line ${String(h.oldStart)}) doesn't match the file: its context/removed lines (starting "${first.trim().slice(0, 60)}") aren't there.`,
      };
    }
    out.push(...lines.slice(pos, at), ...repl);
    pos = at + old.length;
  }
  out.push(...lines.slice(pos));
  return { ok: true, text: out.join("\n") + (trailingNewline ? "\n" : "") };
}

/** Line diff (LCS) as a unified diff with `context` lines around each change. */
export function makeUnifiedDiff(
  oldText: string,
  newText: string,
  file = "sketch.ino",
  context = 3,
): string {
  const a = oldText.replace(/\n$/, "").split("\n");
  const b = newText.replace(/\n$/, "").split("\n");
  const n = a.length;
  const m = b.length;
  // LCS table (sketches are small: a few hundred lines).
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i] as Uint32Array;
    const next = dp[i + 1] as Uint32Array;
    for (let j = m - 1; j >= 0; j--)
      row[j] = a[i] === b[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
  }
  type Op = { t: " " | "-" | "+"; line: string; ai: number; bi: number };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) ops.push({ t: " ", line: a[i++] ?? "", ai: i, bi: ++j });
    // Prefer deleting first, so a changed line reads "-old" then "+new".
    else if (i < n && (j >= m || (dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)))
      ops.push({ t: "-", line: a[i++] ?? "", ai: i, bi: j });
    else ops.push({ t: "+", line: b[j++] ?? "", ai: i, bi: j });
  }
  const changed = ops.map((o, k) => (o.t !== " " ? k : -1)).filter((k) => k >= 0);
  if (changed.length === 0) return "";
  const out = [`--- a/${file}`, `+++ b/${file}`];
  let k = 0;
  while (k < changed.length) {
    const start = Math.max(0, (changed[k] ?? 0) - context);
    let end = Math.min(ops.length, (changed[k] ?? 0) + context + 1);
    while (k + 1 < changed.length && (changed[k + 1] ?? 0) - context <= end) {
      k++;
      end = Math.min(ops.length, (changed[k] ?? 0) + context + 1);
    }
    const slice = ops.slice(start, end);
    // Line numbers where the hunk starts (1-based) in the old and new files.
    let oldStart = 1;
    let newStart = 1;
    for (const o of ops.slice(0, start)) {
      if (o.t !== "+") oldStart++;
      if (o.t !== "-") newStart++;
    }
    const oldLines = slice.filter((o) => o.t !== "+").length;
    const newLines = slice.filter((o) => o.t !== "-").length;
    out.push(
      `@@ -${String(oldLines === 0 ? oldStart - 1 : oldStart)},${String(oldLines)} +${String(newLines === 0 ? newStart - 1 : newStart)},${String(newLines)} @@`,
    );
    for (const o of slice) out.push(`${o.t}${o.line}`);
    k++;
  }
  return `${out.join("\n")}\n`;
}
