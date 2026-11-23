import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Track } from "@linelab/schema";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { TrackBuilder } from "./builder.js";
import { ProgressTracker, TrackField, sampleTrack } from "./geometry.js";
import { validateTrackGeometry } from "./validate.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "tracks");
const builtIn = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => Track.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))));
const byId = (id: string) => {
  const t = builtIn.find((x) => x.id === id);
  if (!t) throw new Error(id);
  return t;
};

describe("built-in tracks", () => {
  it("there are at least 15, all schema-valid and geometrically sound", () => {
    expect(builtIn.length).toBeGreaterThanOrEqual(15);
    for (const t of builtIn) expect(validateTrackGeometry(t), t.id).toEqual([]);
  });

  it("closed loops end where they start", () => {
    for (const id of [
      "track.oval",
      "track.circle",
      "track.figure-eight",
      "track.right-angles",
      "track.dashed",
      "track.inverted",
    ]) {
      const { samples } = sampleTrack(byId(id));
      const a = samples[0];
      const b = samples.at(-1);
      expect(Math.hypot((a?.x ?? 0) - (b?.x ?? 1), (a?.y ?? 0) - (b?.y ?? 1)), id).toBeLessThan(
        0.1,
      );
    }
  });
});

describe("arc length and queries", () => {
  const oval = byId("track.oval");
  const field = new TrackField(oval);

  it("oval length = 2 straights + one full circle", () => {
    expect(field.path.length).toBeCloseTo(2 * 1200 + 2 * Math.PI * 300, 0);
  });

  it("closest point and signed lateral offset", () => {
    // First straight runs along +x from (0,0); left of travel is +y.
    const left = field.closest(500, 12);
    expect(left?.distance).toBeCloseTo(12, 6);
    expect(left?.lateral).toBeCloseTo(12, 6);
    expect(left?.s).toBeCloseTo(500, 6);
    expect(field.closest(500, -7)?.lateral).toBeCloseTo(-7, 6);
    expect(field.closest(5000, 5000)).toBeUndefined();
  });

  it("reflectance: dark on the line, light off it, edge at half the line width", () => {
    expect(field.reflectanceAt(500, 0)).toBe(0.05);
    expect(field.reflectanceAt(500, 9.4)).toBe(0.05);
    expect(field.reflectanceAt(500, 9.6)).toBe(0.85);
    expect(field.reflectanceAt(500, 100)).toBe(0.85);
  });

  it("at(s) walks the path", () => {
    const p = field.at(600);
    expect(p.x).toBeCloseTo(600, 6);
    expect(p.y).toBeCloseTo(0, 6);
    expect(p.headingRad).toBeCloseTo(0, 6);
    const q = field.at(1200 + Math.PI * 150); // halfway round the first curve
    expect(q.headingRad).toBeCloseTo(Math.PI / 2, 2);
  });

  it("matches a brute-force distance for random points (property)", () => {
    const { samples } = field.path;
    const brute = (x: number, y: number) => {
      let best = Infinity;
      for (let i = 0; i + 1 < samples.length; i++) {
        const a = samples[i];
        const b = samples[i + 1];
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const l2 = dx * dx + dy * dy;
        const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
        best = Math.min(best, Math.hypot(x - a.x - t * dx, y - a.y - t * dy));
      }
      return best;
    };
    fc.assert(
      fc.property(
        fc.double({ min: -400, max: 1600, noNaN: true }),
        fc.double({ min: -400, max: 1000, noNaN: true }),
        (x, y) => {
          const b = brute(x, y);
          const c = field.closest(x, y, 300);
          if (b > 300) return c === undefined || c.distance <= 300;
          return c !== undefined && Math.abs(c.distance - b) < 1e-6;
        },
      ),
      { numRuns: 300, seed: 42 },
    );
  });
});

describe("features", () => {
  it("figure eight: the crossing point is on the line", () => {
    const f = new TrackField(byId("track.figure-eight"));
    expect(f.onLine(0, 0)).toBe(true);
  });

  it("dashed: no paint inside a gap", () => {
    const t = byId("track.dashed");
    const f = new TrackField(t);
    const gap = t.features.find((x) => x.type === "gap");
    if (gap?.type !== "gap") throw new Error("no gap");
    const mid = f.at((gap.startS + gap.endS) / 2);
    expect(f.onLine(mid.x, mid.y)).toBe(false);
    const before = f.at(gap.startS - 5);
    expect(f.onLine(before.x, before.y)).toBe(true);
  });

  it("inverted: line becomes light, nearby background dark", () => {
    const t = byId("track.inverted");
    const f = new TrackField(t);
    const inv = t.features.find((x) => x.type === "inversion");
    if (inv?.type !== "inversion") throw new Error("no inversion");
    const mid = f.at((inv.startS + inv.endS) / 2);
    expect(f.reflectanceAt(mid.x, mid.y)).toBe(t.surface.backgroundReflectance);
    expect(f.reflectanceAt(mid.x, mid.y + 20)).toBe(t.surface.lineReflectance);
    const normal = f.at(inv.endS + 100);
    expect(f.reflectanceAt(normal.x, normal.y)).toBe(t.surface.lineReflectance);
  });
});

describe("ProgressTracker", () => {
  it("is monotonic along the oval and counts laps", () => {
    const f = new TrackField(byId("track.oval"));
    const p = new ProgressTracker(f);
    let last = -1;
    for (let lap = 0; lap < 2; lap++) {
      for (let s = 0; s < f.path.length; s += 20) {
        const q = f.at(s);
        const r = p.update(q.x + 3, q.y + 3);
        expect(r.total).toBeGreaterThanOrEqual(last - 1e-6);
        last = r.total;
      }
    }
    expect(p.update(f.at(10).x, f.at(10).y).laps).toBe(2);
  });

  it("does not jump branches at the figure-eight crossing", () => {
    const f = new TrackField(byId("track.figure-eight"));
    const p = new ProgressTracker(f);
    let last = 0;
    for (let s = 150; s < f.path.length; s += 10) {
      const q = f.at(s);
      const r = p.update(q.x, q.y);
      expect(Math.abs(r.s - s)).toBeLessThan(1);
      last = r.s;
    }
    expect(last).toBeGreaterThan(f.path.length - 20);
  });
});

describe("validateTrackGeometry", () => {
  const base = new TrackBuilder().forward(500).left(90, 100).forward(300);
  const good = base.build({ id: "track.t", name: "t" }, { x: 10, y: 0, headingRad: 0 });

  it("accepts a continuous track", () => {
    expect(validateTrackGeometry(good)).toEqual([]);
  });

  it("finds a break, a too-tight arc, a feature off the end and an off-line start", () => {
    const broken: Track = {
      ...good,
      segments: [
        ...good.segments,
        { type: "line", from: { x: 900, y: 900 }, to: { x: 1000, y: 900 } },
        {
          type: "arc",
          center: { x: 1000, y: 910 },
          radiusMm: 10,
          startAngleRad: -Math.PI / 2,
          sweepRad: 1,
        },
      ],
      features: [{ type: "gap", startS: 5000, endS: 6000 }],
      start: { x: 0, y: 200, headingRad: 0 },
    };
    const msgs = validateTrackGeometry(broken)
      .map((p) => p.message)
      .join("\n");
    expect(msgs).toMatch(/segment 3 starts .* away/);
    expect(msgs).toMatch(/tighter than the 19 mm line/);
    expect(msgs).toMatch(/gap ends at 6000 mm/);
    expect(msgs).toMatch(/start pose is .* off the line/);
  });
});
