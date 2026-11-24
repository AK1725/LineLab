import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getChassis, getComponent } from "@linelab/component-db";
import { resolveChassis } from "@linelab/design-core";
import { Design, Track } from "@linelab/schema";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CachedCompiler } from "./compiler.js";
import { verifyPatch } from "./gate.js";
import { applyUnifiedDiff } from "./patch.js";
import { Workbench, type OkEvaluation } from "./workbench.js";

const repo = join(import.meta.dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const expected = z
  .object({ fixtures: z.record(z.string(), z.object({ track: z.string() })) })
  .parse(JSON.parse(read("examples/firmware/buggy/expected.json")));
const design = Design.parse(JSON.parse(read("packages/sim-core/fixtures/reference.design.json")));
const chassis = resolveChassis(design, getChassis);
if (!chassis) throw new Error("chassis");
// Real compiler output, cached; no compiler is needed to run these tests.
const compiler = new CachedCompiler(join(repo, "examples", "firmware", ".compile-cache"));

export function workbenchFor(trackId: string) {
  const track = Track.parse(JSON.parse(read(`tracks/track.${trackId}.json`)));
  return new Workbench(
    {
      design,
      chassis: chassis as NonNullable<typeof chassis>,
      lookup: getComponent,
      track,
      board: "arduino:avr:nano",
      file: "sketch.ino",
      seeds: [0],
    },
    compiler,
  );
}

async function ok(wb: Workbench, src: string): Promise<OkEvaluation> {
  const e = await wb.evaluate(src);
  if (!e.ok) throw new Error(`not compiled: ${JSON.stringify(e.diagnostics)}`);
  return e;
}

describe("the verification gate accepts the reference fix for every buggy fixture", () => {
  it.each(Object.entries(expected.fixtures))(
    "%s",
    async (name, fx) => {
      const wb = workbenchFor(fx.track);
      const src = read(`examples/firmware/buggy/${name}/${name}.ino`);
      const patched = applyUnifiedDiff(src, read(`examples/firmware/buggy/${name}/fix.diff`));
      if (!patched.ok) throw new Error(patched.error);
      const gate = verifyPatch(await ok(wb, src), await wb.evaluate(patched.text));
      expect(gate.reasons, name).toEqual([]);
      expect(gate.accepted).toBe(true);
      expect(gate.improvements.length).toBeGreaterThan(0);
    },
    120_000,
  );
});

describe("the gate rejects patches that don't help or make things worse", () => {
  const src = read("examples/firmware/buggy/blocking_delay/blocking_delay.ino");
  it("a patch that doesn't compile", async () => {
    const wb = workbenchFor("oval");
    const gate = verifyPatch(
      await ok(wb, src),
      await wb.evaluate(src.replace("delay(25);", "delay(25)")),
    );
    expect(gate.accepted).toBe(false);
    expect(gate.reasons.join(" ")).toMatch(/compil/);
  }, 120_000);
  it("a patch that changes nothing measurable", async () => {
    const wb = workbenchFor("oval");
    const before = await ok(wb, src);
    const gate = verifyPatch(before, before);
    expect(gate.accepted).toBe(false);
    expect(gate.reasons).toEqual([
      "Nothing measurably improved: no fewer failures, events or findings on any seed.",
    ]);
  }, 120_000);
  it("a patch that makes the robot fail (reversing a motor) is rejected with the new errors named", async () => {
    const wb = workbenchFor("oval");
    const good = read("examples/firmware/buggy/inverted_motor/inverted_motor.ino");
    const fixed = applyUnifiedDiff(good, read("examples/firmware/buggy/inverted_motor/fix.diff"));
    if (!fixed.ok) throw new Error(fixed.error);
    // Going from the fixed sketch to the inverted one must fail the gate.
    const gate = verifyPatch(await ok(wb, fixed.text), await wb.evaluate(good));
    expect(gate.accepted).toBe(false);
    expect(gate.reasons.join(" ")).toMatch(/Robustness drops|New error/);
  }, 120_000);
});
