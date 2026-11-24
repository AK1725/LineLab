import { COMPONENTS, createSearchIndex } from "@linelab/component-db";
import { runRules } from "@linelab/rules-engine";
import { describe, expect, it } from "vitest";
import { matchDetections, modelTokens } from "./match.js";
import { estimateScale, proposeDesign, type Pick } from "./propose.js";
import { syntheticTopView, withBoxes } from "./synthetic.js";
import { CHASSIS, FIXTURES, fixture, getChassis, getComponent } from "./test-kit.js";

const index = createSearchIndex(COMPONENTS);

describe("database matching (scripted detections)", () => {
  it("puts the right part in the top 3 for every major component of the 5 fixture robots", () => {
    let hits = 0;
    let total = 0;
    const misses: string[] = [];
    for (const id of FIXTURES) {
      const f = fixture(id);
      const matches = matchDetections(f.detections.detections, index, COMPONENTS);
      f.truth.components.forEach((t, i) => {
        total++;
        const m = matches[i];
        if (m?.candidates.some((c) => c.componentId === t.componentId)) hits++;
        else
          misses.push(
            `${id}: ${t.componentId} → ${m?.candidates.map((c) => c.componentId).join(", ")}`,
          );
      });
    }
    expect(misses).toEqual([]);
    expect(hits / total).toBeGreaterThanOrEqual(0.8);
  });

  it("finds part-number-like words in a description", () => {
    expect(modelTokens("small purple carrier with a TB6612FNG chip, 16 pins, 65mm")).toEqual([
      "TB6612FNG",
      "65mm",
    ]);
  });

  it("still offers 3 parts of the right category when nothing matches", () => {
    const [m] = matchDetections(
      [
        {
          id: "x",
          category: "battery",
          description: "a thing",
          markings: [],
          count: 1,
          confidence: 0.2,
        },
      ],
      index,
      COMPONENTS,
    );
    expect(m?.candidates).toHaveLength(3);
    expect(m?.candidates.every((c) => c.componentId.startsWith("battery."))).toBe(true);
  });
});

/** Picks = the truth (as if the user confirmed the right candidate each time). */
const truthPicks = (id: string): Pick[] => {
  const f = fixture(id);
  return f.truth.components.map((t, i) => ({
    detectionId: f.detections.detections[i]?.id ?? "",
    componentId: t.componentId,
    count: t.count,
  }));
};

describe("design proposal from a (synthetic) top view", () => {
  for (const id of FIXTURES) {
    it(`${id}: right parts, scale within 5 %, photo positions within 6 mm, valid after confirming nets`, () => {
      const f = fixture(id);
      const view = syntheticTopView(f.design, f.chassis, getComponent);
      const picks = truthPicks(id);
      const dets = withBoxes(
        f.detections.detections,
        (d) => picks.find((p) => p.detectionId === d.id)?.componentId,
        view,
      );
      const top = { widthPx: view.widthPx, heightPx: view.heightPx, outline: view.outline };
      const scale = estimateScale(dets, picks, top, "up", getComponent);
      expect(Math.abs((scale ?? 0) / view.mmPerPx - 1)).toBeLessThan(0.05);

      const p = proposeDesign({
        id: "p1",
        name: id,
        detections: dets,
        picks,
        top,
        frontInTop: "up",
        lookup: getComponent,
        getChassis,
        templates: CHASSIS,
      });
      expect(p.chassisSource).toBe("photo");
      const count = (xs: string[]) => [...xs].sort().join(",");
      expect(count(p.design.placements.map((x) => x.componentId))).toBe(
        count(f.design.placements.map((x) => x.componentId)),
      );
      // Parts placed from the photo land where they really are (axle-midpoint frame).
      for (const pl of p.design.placements) {
        const c = getComponent(pl.componentId);
        if (!c || pl.mount === "bottom" || c.category === "wheel") continue;
        const real = f.design.placements.find((x) => x.componentId === pl.componentId);
        if (!real) continue;
        expect(
          Math.hypot(pl.position.x - real.position.x, pl.position.y - real.position.y),
        ).toBeLessThan(6);
      }
      // Confirm every proposed net: a valid design (no errors from the rules engine).
      const design = { ...p.design, netlist: p.proposedNets };
      const ch = design.chassis.kind === "custom" ? design.chassis.chassis : undefined;
      expect(ch).toBeDefined();
      const errors = ch
        ? runRules(design, ch, getComponent).filter((x) => x.severity === "error")
        : [];
      expect(errors.map((e) => `${e.id}: ${e.message}`)).toEqual([]);
    });
  }

  it("falls back to the closest template without a silhouette", () => {
    const id = "uno-l9110s-tt";
    const f = fixture(id);
    const p = proposeDesign({
      id: "p2",
      name: id,
      detections: f.detections.detections,
      picks: truthPicks(id),
      frontInTop: "up",
      lookup: getComponent,
      getChassis,
      templates: CHASSIS,
    });
    expect(p.chassisSource).toBe("template");
    expect(p.design.chassis).toEqual({ kind: "template", chassisId: "chassis.starter-2wd" });
    expect(p.scaleMmPerPx).toBeUndefined();
  });

  it("handles a photo taken with the robot's front to the right", () => {
    const id = "nano-tb6612-qtr8a";
    const f = fixture(id);
    const view = syntheticTopView(f.design, f.chassis, getComponent);
    const picks = truthPicks(id);
    // Rotate the image 90° clockwise: front (up) now points right.
    const rot = (b: { x: number; y: number; w: number; h: number }) => ({
      x: 1 - b.y - b.h,
      y: b.x,
      w: b.h,
      h: b.w,
    });
    const dets = withBoxes(
      f.detections.detections,
      (d) => picks.find((p) => p.detectionId === d.id)?.componentId,
      view,
    ).map((d) => (d.topBox ? { ...d, topBox: rot(d.topBox) } : d));
    const p = proposeDesign({
      id: "p3",
      name: id,
      detections: dets,
      picks,
      top: {
        widthPx: view.heightPx,
        heightPx: view.widthPx,
        outline: view.outline.map((q) => ({ x: 1 - q.y, y: q.x })),
      },
      frontInTop: "right",
      lookup: getComponent,
      getChassis,
      templates: CHASSIS,
    });
    const mcu = p.design.placements.find((x) => x.componentId === "mcu.arduino-nano");
    const real = f.design.placements.find((x) => x.componentId === "mcu.arduino-nano");
    expect(
      Math.hypot(
        (mcu?.position.x ?? 0) - (real?.position.x ?? 99),
        (mcu?.position.y ?? 0) - (real?.position.y ?? 99),
      ),
    ).toBeLessThan(6);
  });
});
