import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyUnifiedDiff, makeUnifiedDiff, parseUnifiedDiff } from "./patch.js";

const src = "a\nb\nc\nd\ne\nf\ng\n";

describe("unified diffs", () => {
  it("applies a hunk exactly, and with a shifted position", () => {
    const diff = "--- a/s.ino\n+++ b/s.ino\n@@ -2,3 +2,3 @@\n b\n-c\n+C\n d\n";
    expect(applyUnifiedDiff(src, diff)).toEqual({ ok: true, text: "a\nb\nC\nd\ne\nf\ng\n" });
    // Wrong line number but the context is unique: still applies (like `patch` with an offset).
    expect(applyUnifiedDiff(src, diff.replace("@@ -2,3 +2,3 @@", "@@ -5,3 +5,3 @@"))).toEqual({
      ok: true,
      text: "a\nb\nC\nd\ne\nf\ng\n",
    });
  });
  it("refuses a hunk whose context isn't in the file", () => {
    const r = applyUnifiedDiff(src, "@@ -2,2 +2,2 @@\n b\n-x\n+y\n");
    expect(r.ok).toBe(false);
    expect(applyUnifiedDiff(src, "just some text").ok).toBe(false);
  });
  it("parses headers and multiple hunks", () => {
    expect(
      parseUnifiedDiff("--- a\n+++ b\n@@ -1 +1 @@\n-a\n+A\n@@ -7,1 +7,2 @@\n g\n+h\n").map((h) => [
        h.oldStart,
        h.lines.length,
      ]),
    ).toEqual([
      [1, 2],
      [7, 2],
    ]);
  });
  it("round-trips: applying makeUnifiedDiff(a, b) to a gives b (property)", () => {
    const line = fc.constantFrom("x", "y", "z", "int a;", "}", "", "delay(5);");
    fc.assert(
      fc.property(
        fc.array(line, { maxLength: 30 }),
        fc.array(line, { maxLength: 30 }),
        (xs, ys) => {
          const a = `${xs.join("\n")}\n`;
          const b = `${ys.join("\n")}\n`;
          const d = makeUnifiedDiff(a, b);
          if (a === b || d === "") return;
          const r = applyUnifiedDiff(a, d);
          expect(r).toEqual({ ok: true, text: b });
        },
      ),
      { numRuns: 300 },
    );
  });
});
