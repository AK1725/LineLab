import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getChassis, getComponent } from "@linelab/component-db";
import { resolveChassis } from "@linelab/design-core";
import { runFirmware } from "@linelab/firmware-runtime";
import { Design, FirmwareArtifact, Track } from "@linelab/schema";
import { buildRobotModel, SIM_FIELD, TrackField } from "@linelab/sim-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildRunReport } from "./index.js";

const repo = join(import.meta.dirname, "..", "..", "..");
const json = (p: string): unknown => JSON.parse(readFileSync(join(repo, p), "utf8"));
const Expectation = z.object({
  kind: z.enum(["event", "lint"]),
  id: z.string(),
  line: z.number().optional(),
  contains: z.string().optional(),
});
const Expected = z.object({
  fixtures: z.record(z.string(), z.object({ track: z.string(), expect: z.array(Expectation) })),
  clean: z.object({ sketch: z.string(), tracks: z.array(z.string()) }),
});
const expected = Expected.parse(json("examples/firmware/buggy/expected.json"));
const design = Design.parse(json("packages/sim-core/fixtures/reference.design.json"));
const chassis = resolveChassis(design, getChassis);
if (!chassis) throw new Error("chassis");
const robot = buildRobotModel(design, chassis, getComponent);

function report(dir: string, name: string, trackId: string) {
  const track = Track.parse(json(`tracks/track.${trackId}.json`));
  const artifact = FirmwareArtifact.parse(json(`${dir}/${name}.nano.artifact.json`));
  const source = readFileSync(join(repo, dir, `${name}.ino`), "utf8");
  const run = runFirmware({
    design,
    lookup: getComponent,
    robot,
    track,
    artifact,
    config: { seed: 0 },
  });
  return {
    source,
    report: buildRunReport({
      result: run.result,
      field: new TrackField(track, SIM_FIELD),
      recordEveryMs: 10,
      firmware: { run, source, file: `${name}.ino` },
    }),
  };
}

describe("buggy fixtures trigger their expected event or rule at the right line", () => {
  it("covers at least 12 bugs", () => {
    expect(Object.keys(expected.fixtures).length).toBeGreaterThanOrEqual(12);
  });
  it.each(Object.entries(expected.fixtures))(
    "%s",
    (name, fx) => {
      const { source, report: r } = report(`examples/firmware/buggy/${name}`, name, fx.track);
      const lines = source.split("\n");
      for (const e of fx.expect) {
        const found =
          e.kind === "event"
            ? r.events.filter((x) => x.type === e.id).map((x) => x.sourceLoc?.line)
            : r.lint.filter((x) => x.ruleId === e.id).map((x) => x.line);
        expect(found.length, `${name}: ${e.kind} ${e.id} missing`).toBeGreaterThan(0);
        if (e.line !== undefined) {
          expect(found, `${name}: ${e.id} line`).toContain(e.line);
          expect(lines[e.line - 1], `${name}: line ${String(e.line)} text`).toContain(
            e.contains ?? "",
          );
        }
      }
    },
    120_000,
  );
});

describe("the good sketch", () => {
  it.each(expected.clean.tracks)(
    "good_pid.ino has no error-level events or findings on %s",
    (trackId) => {
      const { report: r } = report("examples/firmware/good_pid", expected.clean.sketch, trackId);
      expect(r.outcome).toBe("finished");
      expect(r.events.filter((e) => e.severity === "error")).toEqual([]);
      expect(r.lint).toEqual([]);
    },
    120_000,
  );
});
