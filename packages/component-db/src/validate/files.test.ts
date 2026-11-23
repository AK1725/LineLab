import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Track } from "@linelab/schema";
import { validateTargets } from "./files.js";

const track = (id: string) => ({
  id,
  name: "t",
  units: "mm",
  surface: {
    lineColor: "#000000",
    backgroundColor: "#ffffff",
    lineReflectance: 0.05,
    backgroundReflectance: 0.9,
  },
  lineWidthMm: 19,
  segments: [{ type: "line", from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }],
  features: [],
  start: { x: 0, y: 0, headingRad: 0 },
});

let dir: string;
function setup(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), "linelab-db-"));
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const run = (d: string) => validateTargets([{ label: "tracks", dir: d, schema: Track }], d);

describe("validateTargets", () => {
  it("passes valid files, including nested folders", () => {
    const d = setup({
      "track.a.json": JSON.stringify(track("track.a")),
      "sub/track.b.json": JSON.stringify(track("track.b")),
    });
    const report = run(d);
    expect(report.problems).toEqual([]);
    expect(report.checked).toBe(2);
    expect(report.valid.map((v) => v.data.id).sort()).toEqual(["track.a", "track.b"]);
  });

  it("reports invalid JSON, schema errors, file-name mismatch and duplicate ids", () => {
    const d = setup({
      "broken.json": "{ nope",
      "track.bad.json": JSON.stringify({ ...track("track.bad"), lineWidthMm: -1 }),
      "wrong-name.json": JSON.stringify(track("track.c")),
      "track.d.json": JSON.stringify(track("track.d")),
      "x/track.d.json": JSON.stringify(track("track.d")),
    });
    const messages = run(d).problems.map((p) => `${p.file}: ${p.message}`);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^broken\.json: invalid JSON/),
        expect.stringMatching(/^track\.bad\.json: lineWidthMm:/),
        expect.stringMatching(/^wrong-name\.json: file name must be "track\.c\.json"/),
        expect.stringMatching(/duplicate id "track\.d"/),
      ]),
    );
  });

  it("treats a missing directory as empty", () => {
    const d = setup({});
    expect(validateTargets([{ label: "x", dir: join(d, "missing"), schema: Track }], d)).toEqual({
      checked: 0,
      problems: [],
      valid: [],
    });
  });
});
