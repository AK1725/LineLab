import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  Chassis,
  Component,
  Design,
  Finding,
  Quat,
  RunTrace,
  Track,
  Vec2,
  documentSchemas,
  formatIssues,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(here, "fixtures", name), "utf8")) as Record<string, unknown>;
}

/** Deep clone + mutate, so each invalid case starts from a known-valid document. */
function mutate<T>(doc: T, fn: (d: T) => void): T {
  const copy = structuredClone(doc);
  fn(copy);
  return copy;
}

function issuesOf(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  return result.success ? [] : formatIssues(result.error);
}

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment,
   @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any --
   fixtures are untyped JSON that the tests deliberately corrupt */
type Json = any;

describe("valid fixtures parse", () => {
  const cases: [string, z.ZodType, string][] = [
    ["component", Component, "component.tb6612fng.json"],
    ["chassis", Chassis, "chassis.starter.json"],
    ["design", Design, "design.minimal.json"],
    ["track", Track, "track.oval.json"],
    ["run trace", RunTrace, "run-trace.short.json"],
    ["finding", Finding, "finding.ground.json"],
  ];
  it.each(cases)("%s", (_label, schema, file) => {
    expect(issuesOf(schema, fixture(file))).toEqual([]);
  });
});

describe("Component", () => {
  const base: Json = fixture("component.tb6612fng.json");

  it("rejects duplicate pin ids", () => {
    const bad = mutate(base, (d) =>
      d.pins.push({ id: "VM", label: "dup", functions: ["power_in"] }),
    );
    expect(issuesOf(Component, bad)).toContainEqual(
      expect.stringContaining('Duplicate pin id "VM"'),
    );
  });

  it("rejects an electrical spec that does not match the category", () => {
    const bad = mutate(base, (d) => (d.category = "mcu"));
    expect(issuesOf(Component, bad).join("\n")).toMatch(/Category "mcu" expects electrical.kind/);
  });

  it("requires at least one source", () => {
    const bad = mutate(base, (d) => (d.sources = []));
    expect(issuesOf(Component, bad).join("\n")).toMatch(/Cite at least one source/);
  });

  it("rejects non-dotted ids and unknown fields", () => {
    expect(
      issuesOf(
        Component,
        mutate(base, (d) => (d.id = "TB6612")),
      ),
    ).not.toEqual([]);
    expect(
      issuesOf(
        Component,
        mutate(base, (d) => (d.colour = "red")),
      ),
    ).not.toEqual([]);
  });

  it("rejects non-positive dimensions and inverted ranges", () => {
    expect(
      issuesOf(
        Component,
        mutate(base, (d) => (d.dimensionsMm.x = 0)),
      ),
    ).not.toEqual([]);
    const inverted = mutate(base, (d) => (d.electrical.motorVoltage = { min: 13.5, max: 4.5 }));
    expect(issuesOf(Component, inverted).join("\n")).toMatch(/min must be <= max/);
  });

  it("checks battery voltage ordering", () => {
    const battery = mutate(base, (d) => {
      d.category = "battery";
      d.pins = [];
      d.electrical = {
        kind: "battery",
        chemistry: "lipo",
        cellsInSeries: 2,
        nominalVoltageV: 7.4,
        fullVoltageV: 8.4,
        cutoffVoltageV: 6.0,
        capacitymAh: 450,
        maxContinuousDischargeA: 20,
        internalResistanceMilliohm: 30,
      };
    });
    expect(issuesOf(Component, battery)).toEqual([]);
    const bad = mutate(battery, (d) => (d.electrical.cutoffVoltageV = 9));
    expect(issuesOf(Component, bad).join("\n")).toMatch(/cutoffVoltageV < nominalVoltageV/);
  });
});

describe("Chassis", () => {
  const base: Json = fixture("chassis.starter.json");

  it("needs a left and a right wheel", () => {
    const bad = mutate(base, (d) => (d.wheelMounts[1].side = "left"));
    expect(issuesOf(Chassis, bad).join("\n")).toMatch(/left and one right/);
  });

  it("needs a real polygon outline", () => {
    const bad = mutate(base, (d) => (d.outline = d.outline.slice(0, 2)));
    expect(issuesOf(Chassis, bad).join("\n")).toMatch(/at least 3 points/);
  });

  it("rejects duplicate deck indices", () => {
    const bad = mutate(base, (d) => d.decks.push({ index: 0, heightMm: 40 }));
    expect(issuesOf(Chassis, bad).join("\n")).toMatch(/Duplicate deck index/);
  });
});

describe("Design", () => {
  const base: Json = fixture("design.minimal.json");

  it("rejects duplicate instance ids", () => {
    const bad = mutate(base, (d) => (d.placements[1].instanceId = "mcu1"));
    expect(issuesOf(Design, bad).join("\n")).toMatch(/Duplicate instanceId "mcu1"/);
  });

  it("rejects nets that reference a missing part", () => {
    const bad = mutate(base, (d) =>
      d.netlist[0].connections.push({ instanceId: "ghost", pinId: "GND" }),
    );
    expect(issuesOf(Design, bad).join("\n")).toMatch(/unknown instance "ghost"/);
  });

  it("rejects a pin that belongs to two nets", () => {
    const bad = mutate(base, (d) =>
      d.netlist[1].connections.push({ instanceId: "mcu1", pinId: "GND" }),
    );
    expect(issuesOf(Design, bad).join("\n")).toMatch(/in both net "gnd" and net "pwma"/);
  });

  it("rejects unknown boards", () => {
    const bad = mutate(base, (d) => (d.firmware.board = "arduino:avr:toaster"));
    expect(issuesOf(Design, bad)).not.toEqual([]);
  });

  it("accepts an inline custom chassis", () => {
    const custom = mutate(
      base,
      (d) => (d.chassis = { kind: "custom", chassis: fixture("chassis.starter.json") }),
    );
    expect(issuesOf(Design, custom)).toEqual([]);
  });
});

describe("Track", () => {
  const base: Json = fixture("track.oval.json");

  it("rejects a line the sensors cannot distinguish", () => {
    const bad = mutate(base, (d) => (d.surface.lineReflectance = 0.83));
    expect(issuesOf(Track, bad).join("\n")).toMatch(/must differ/);
  });

  it("rejects zero-sweep arcs", () => {
    const bad = mutate(base, (d) => (d.segments[1].sweepRad = 0));
    expect(issuesOf(Track, bad)).not.toEqual([]);
  });

  it("rejects inverted gap spans", () => {
    const bad = mutate(base, (d) => d.features.push({ type: "gap", startS: 500, endS: 400 }));
    expect(issuesOf(Track, bad).join("\n")).toMatch(/endS must be greater than startS/);
  });
});

describe("RunTrace", () => {
  const base: Json = fixture("run-trace.short.json");

  it("rejects frames out of time order", () => {
    const bad = mutate(base, (d) => {
      d.frames[0].tMs = 5;
      d.frames[1].tMs = 1;
    });
    expect(issuesOf(RunTrace, bad).join("\n")).toMatch(/non-decreasing time order/);
  });

  it("rejects PWM outside [-1, 1]", () => {
    const bad = mutate(base, (d) => (d.frames[0].pwm.left = 1.5));
    expect(issuesOf(RunTrace, bad)).not.toEqual([]);
  });
});

describe("Finding", () => {
  it("requires a namespaced rule id", () => {
    const bad = mutate(fixture("finding.ground.json") as Json, (d) => (d.id = "no namespace"));
    expect(issuesOf(Finding, bad)).not.toEqual([]);
  });
});

describe("numbers", () => {
  it("reject NaN and Infinity (Zod 4 default)", () => {
    expect(Vec2.safeParse({ x: Number.POSITIVE_INFINITY, y: 0 }).success).toBe(false);
    expect(Vec2.safeParse({ x: Number.NaN, y: 0 }).success).toBe(false);
  });
});

describe("Quat", () => {
  it("accepts unit quaternions and rejects others", () => {
    expect(Quat.safeParse({ x: 0, y: 0, z: 0.7071068, w: 0.7071068 }).success).toBe(true);
    expect(Quat.safeParse({ x: 0, y: 0, z: 0, w: 2 }).success).toBe(false);
  });
});

describe("documentSchemas", () => {
  it("lists every top-level document", () => {
    expect(Object.keys(documentSchemas).sort()).toEqual(
      ["chassis", "component", "design", "finding", "run-trace", "track"].sort(),
    );
  });
});
