import { describe, expect, it } from "vitest";
import { COMPONENTS, createSearchIndex } from "./index.js";

const index = createSearchIndex(COMPONENTS);
const first = (q: string, categories?: Parameters<typeof index.search>[1]) =>
  index.search(q, categories)[0]?.component.id;

describe("search — Phase 1 acceptance queries return the right part first", () => {
  it.each([
    ["l298", "driver.l298n-module"],
    ["qtr8", "sensor.pololu-qtr-8a"],
    ["n20 1000", "motor.n20-6v-1000rpm"],
    ["esp32 s3", "mcu.esp32-s3-devkitc-1"],
    ["tb6612", "driver.tb6612fng"],
  ])("%s → %s", (query, expected) => {
    expect(first(query)).toBe(expected);
  });
});

describe("search behaviour", () => {
  it("ignores case, spaces and punctuation", () => {
    expect(first("TB 6612-FNG")).toBe("driver.tb6612fng");
    expect(first("ESP32-S3")).toBe("mcu.esp32-s3-devkitc-1");
    expect(first("QTR-8RC")).toBe("sensor.pololu-qtr-8rc");
  });

  it("ranks gear-ratio queries to the matching motor", () => {
    expect(first("n20 1000:1")).toBe("motor.pololu-hp-6v-1000-1");
    expect(first("hp 30:1")).toBe("motor.pololu-hp-6v-30-1");
  });

  it("requires every word of a multi-word query", () => {
    const hits = index.search("pololu wheel 60");
    expect(hits[0]?.component.id).toBe("wheel.pololu-60x8");
    expect(hits.every((h) => h.component.name.toLowerCase().includes("pololu"))).toBe(true);
  });

  it("does not treat a shorter number as a match ('1000' is not '100')", () => {
    const ids = index.search("n20 1000").map((h) => h.component.id);
    expect(ids).not.toContain("motor.n20-6v-100rpm");
  });

  it("tolerates word suffixes like plurals", () => {
    expect(index.search("arduinos").length).toBeGreaterThan(0);
  });

  it("matches word prefixes", () => {
    expect(index.search("arduino na").map((h) => h.component.id)).toEqual(
      expect.arrayContaining([
        "mcu.arduino-nano",
        "mcu.arduino-nano-every",
        "mcu.arduino-nano-33-iot",
      ]),
    );
  });

  it("falls back to fuzzy matching for typos", () => {
    const hits = index.search("tb6621");
    expect(hits[0]?.component.id).toBe("driver.tb6612fng");
    expect(hits[0]?.match).toBe("fuzzy");
  });

  it("filters by category", () => {
    const hits = index.search("pololu", { categories: ["line_sensor"] });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.component.category === "line_sensor")).toBe(true);
  });

  it("returns the whole catalog, in category order, for an empty query", () => {
    const all = index.search("   ");
    expect(all).toHaveLength(COMPONENTS.length);
    expect(all[0]?.component.category).toBe("mcu");
    expect(all.every((h) => h.match === "all")).toBe(true);
  });

  it("respects limit and returns nothing for gibberish", () => {
    expect(index.search("motor", { limit: 3 })).toHaveLength(3);
    expect(index.search("zzqqxxyy")).toEqual([]);
  });
});
