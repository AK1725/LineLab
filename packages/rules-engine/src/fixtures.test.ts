import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getChassis, getComponent } from "@linelab/component-db";
import { Design } from "@linelab/schema";
import { describe, expect, it } from "vitest";
import { runRules } from "./index.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")) as Record<
  string,
  string[]
>;

describe("Phase 3 acceptance fixtures produce exactly the expected findings", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".design.json"));

  it("every fixture has an expectation and vice versa", () => {
    expect(files.map((f) => f.replace(".design.json", "")).sort()).toEqual(
      Object.keys(expected).sort(),
    );
  });

  for (const file of files) {
    const name = file.replace(".design.json", "");
    it(name, () => {
      const design = Design.parse(JSON.parse(readFileSync(join(dir, file), "utf8")));
      const chassis =
        design.chassis.kind === "template"
          ? getChassis(design.chassis.chassisId)
          : design.chassis.chassis;
      if (!chassis) throw new Error("chassis");
      const ids = [
        ...new Set(runRules(design, chassis, (id) => getComponent(id)).map((f) => f.id)),
      ].sort();
      expect(ids).toEqual([...(expected[name] ?? [])].sort());
    });
  }
});
