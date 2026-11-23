import type { Design, Placement } from "@linelab/schema";
import { describe, expect, it } from "vitest";
import {
  applyCommand,
  canRedo,
  canUndo,
  createHistory,
  endGesture,
  execute,
  redo,
  undo,
  type Command,
  type History,
} from "./history.js";
import { quatFromYaw } from "./placement.js";

const empty: Design = {
  id: "d",
  name: "Robot",
  version: 1,
  chassis: { kind: "template", chassisId: "chassis.starter-2wd" },
  placements: [],
  netlist: [],
};

const placement = (id: string, x = 0, y = 0): Placement => ({
  instanceId: id,
  componentId: "misc.part",
  position: { x, y, z: 10 },
  rotation: quatFromYaw(0),
  deck: 0,
  mount: "top",
  standoffMm: 0,
});

/** Small deterministic PRNG (mulberry32) so the randomised test is reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomCommand(d: Design, r: () => number, n: number): Command {
  const ids = d.placements.map((p) => p.instanceId);
  const pick = () => ids[Math.floor(r() * ids.length)] as string;
  const roll = r();
  if (ids.length === 0 || roll < 0.3)
    return {
      type: "add",
      placements: [placement(`p${n}`, Math.round(r() * 100), Math.round(r() * 50))],
    };
  if (roll < 0.45) return { type: "remove", ids: [pick()] };
  if (roll < 0.9) {
    const id = pick();
    return {
      type: "update",
      changes: [
        {
          id,
          patch: {
            position: { x: Math.round(r() * 100), y: Math.round(r() * 50), z: 10 },
            rotation: quatFromYaw(r() * Math.PI),
          },
        },
      ],
    };
  }
  return { type: "rename", name: `Robot ${n}` };
}

describe("history: undo/redo over many operations", () => {
  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}: 150 random commands undo back to the start and redo forward to the end`, () => {
      const r = rng(seed);
      let h: History = createHistory(empty, 500);
      const states: Design[] = [h.present];
      for (let n = 0; n < 150; n++) {
        h = execute(h, randomCommand(h.present, r, n));
        states.push(h.present);
      }
      // Undo step by step, checking every intermediate state.
      for (let k = states.length - 2; k >= 0; k--) {
        h = undo(h);
        expect(h.present).toEqual(states[k]);
      }
      expect(canUndo(h)).toBe(false);
      for (let k = 1; k < states.length; k++) {
        h = redo(h);
        expect(h.present).toEqual(states[k]);
      }
      expect(canRedo(h)).toBe(false);
    });
  }

  it("a new command after undo discards the redo branch", () => {
    let h = createHistory(empty);
    h = execute(h, { type: "add", placements: [placement("a")] });
    h = execute(h, { type: "add", placements: [placement("b")] });
    h = undo(h);
    h = execute(h, { type: "rename", name: "x" });
    expect(canRedo(h)).toBe(false);
    expect(h.present.placements.map((p) => p.instanceId)).toEqual(["a"]);
  });

  it("coalesces a drag gesture into one undo step", () => {
    let h = createHistory(empty);
    h = execute(h, { type: "add", placements: [placement("a")] });
    h = endGesture(h);
    for (let x = 1; x <= 30; x++) {
      h = execute(
        h,
        { type: "update", changes: [{ id: "a", patch: { position: { x, y: 0, z: 10 } } }] },
        { coalesceKey: "drag-1" },
      );
    }
    h = endGesture(h);
    expect(h.present.placements[0]?.position.x).toBe(30);
    h = undo(h);
    expect(h.present.placements[0]?.position.x).toBe(0);
  });

  it("caps history length", () => {
    let h = createHistory(empty, 10);
    for (let n = 0; n < 25; n++) h = execute(h, { type: "rename", name: `n${n}` });
    expect(h.past).toHaveLength(10);
  });

  it("undo/redo on empty stacks are no-ops", () => {
    const h = createHistory(empty);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });
});

describe("applyCommand", () => {
  it("never mutates its input", () => {
    const d = applyCommand(empty, { type: "add", placements: [placement("a")] });
    const frozen = structuredClone(d);
    applyCommand(d, { type: "update", changes: [{ id: "a", patch: { deck: 1 } }] });
    applyCommand(d, { type: "remove", ids: ["a"] });
    expect(d).toEqual(frozen);
  });

  it("rejects duplicate adds and unknown updates", () => {
    const d = applyCommand(empty, { type: "add", placements: [placement("a")] });
    expect(() => applyCommand(d, { type: "add", placements: [placement("a")] })).toThrow(
      /already exists/,
    );
    expect(() => applyCommand(d, { type: "update", changes: [{ id: "zz", patch: {} }] })).toThrow(
      /unknown instance/,
    );
  });

  it("removing a part drops its pins from nets and deletes nets left with fewer than two pins", () => {
    const d: Design = {
      ...empty,
      placements: [placement("a"), placement("b")],
      netlist: [
        {
          id: "n1",
          name: "GND",
          connections: [
            { instanceId: "a", pinId: "GND" },
            { instanceId: "b", pinId: "GND" },
          ],
        },
        { id: "n2", name: "X", connections: [{ instanceId: "a", pinId: "X" }] },
      ],
    };
    const out = applyCommand(d, { type: "remove", ids: ["a"] });
    expect(out.netlist).toEqual([]);
  });
});

describe("netlist commands", () => {
  const d0: Design = { ...empty, placements: [placement("a"), placement("b"), placement("c")] };
  const e = (instanceId: string, pinId: string) => ({ instanceId, pinId });

  it("connect creates, extends and merges nets", () => {
    let d = applyCommand(d0, { type: "connect", a: e("a", "1"), b: e("b", "1") });
    expect(d.netlist).toHaveLength(1);
    d = applyCommand(d, { type: "connect", a: e("b", "1"), b: e("c", "1") });
    expect(d.netlist[0]?.connections).toHaveLength(3);
    d = applyCommand(d, { type: "connect", a: e("a", "2"), b: e("b", "2") });
    expect(d.netlist).toHaveLength(2);
    d = applyCommand(d, { type: "connect", a: e("c", "1"), b: e("a", "2") });
    expect(d.netlist).toHaveLength(1);
    expect(d.netlist[0]?.connections).toHaveLength(5);
    expect(applyCommand(d, { type: "connect", a: e("a", "1"), b: e("c", "1") })).toEqual(d);
  });

  it("connect rejects unknown parts", () => {
    expect(() => applyCommand(d0, { type: "connect", a: e("zz", "1"), b: e("a", "1") })).toThrow(
      /unknown instance/,
    );
  });

  it("disconnect removes a pin and prunes the net", () => {
    let d = applyCommand(d0, { type: "connect", a: e("a", "1"), b: e("b", "1") });
    d = applyCommand(d, { type: "disconnect", endpoint: e("b", "1") });
    expect(d.netlist).toEqual([]);
  });

  it("rename-net and set-netlist", () => {
    let d = applyCommand(d0, { type: "connect", a: e("a", "1"), b: e("b", "1") });
    const id = d.netlist[0]?.id ?? "";
    d = applyCommand(d, { type: "rename-net", id, name: "GND" });
    expect(d.netlist[0]?.name).toBe("GND");
    d = applyCommand(d, {
      type: "set-netlist",
      netlist: [{ id: "x", name: "lonely", connections: [e("a", "9")] }],
    });
    expect(d.netlist).toEqual([]);
  });
});
