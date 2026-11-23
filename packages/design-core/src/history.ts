import type { Design, Placement } from "@linelab/schema";

export type PlacementPatch = Partial<
  Pick<Placement, "position" | "rotation" | "deck" | "mount" | "standoffMm">
>;

/** Every change to a design is one of these. Commands are pure data, so they can be logged and replayed. */
export type Command =
  | { type: "add"; placements: Placement[] }
  | { type: "remove"; ids: string[] }
  | { type: "update"; changes: { id: string; patch: PlacementPatch }[] }
  | { type: "set-chassis"; chassis: Design["chassis"] }
  | { type: "rename"; name: string };

/** Applies a command and returns a new design; the input is never mutated. */
export function applyCommand(design: Design, cmd: Command): Design {
  switch (cmd.type) {
    case "add": {
      const existing = new Set(design.placements.map((p) => p.instanceId));
      for (const p of cmd.placements) {
        if (existing.has(p.instanceId))
          throw new Error(`add: instance "${p.instanceId}" already exists`);
        existing.add(p.instanceId);
      }
      return { ...design, placements: [...design.placements, ...cmd.placements] };
    }
    case "remove": {
      const ids = new Set(cmd.ids);
      return {
        ...design,
        placements: design.placements.filter((p) => !ids.has(p.instanceId)),
        // Removing a part also removes its pins from every net; nets left empty disappear.
        netlist: design.netlist
          .map((n) => ({ ...n, connections: n.connections.filter((c) => !ids.has(c.instanceId)) }))
          .filter((n) => n.connections.length > 0),
      };
    }
    case "update": {
      const byId = new Map(cmd.changes.map((c) => [c.id, c.patch]));
      for (const id of byId.keys()) {
        if (!design.placements.some((p) => p.instanceId === id))
          throw new Error(`update: unknown instance "${id}"`);
      }
      return {
        ...design,
        placements: design.placements.map((p) => {
          const patch = byId.get(p.instanceId);
          return patch ? { ...p, ...patch } : p;
        }),
      };
    }
    case "set-chassis":
      return { ...design, chassis: cmd.chassis };
    case "rename":
      return { ...design, name: cmd.name };
  }
}

export interface History {
  past: Design[];
  present: Design;
  future: Design[];
  /** Consecutive commands with the same key (one drag gesture) collapse into one undo step. */
  coalesceKey?: string;
  limit: number;
}

export function createHistory(design: Design, limit = 200): History {
  return { past: [], present: design, future: [], limit };
}

export function execute(h: History, cmd: Command, opts: { coalesceKey?: string } = {}): History {
  const next = applyCommand(h.present, cmd);
  if (opts.coalesceKey !== undefined && opts.coalesceKey === h.coalesceKey && h.past.length > 0) {
    return { ...h, present: next, future: [] };
  }
  const past = [...h.past, h.present];
  if (past.length > h.limit) past.shift();
  const out: History = { past, present: next, future: [], limit: h.limit };
  if (opts.coalesceKey !== undefined) out.coalesceKey = opts.coalesceKey;
  return out;
}

/** Ends the current coalescing gesture so the next command starts a new undo step. */
export function endGesture(h: History): History {
  if (h.coalesceKey === undefined) return h;
  const { coalesceKey: _k, ...rest } = h;
  return rest;
}

export const canUndo = (h: History) => h.past.length > 0;
export const canRedo = (h: History) => h.future.length > 0;

export function undo(h: History): History {
  const prev = h.past.at(-1);
  if (prev === undefined) return h;
  return {
    past: h.past.slice(0, -1),
    present: prev,
    future: [h.present, ...h.future],
    limit: h.limit,
  };
}

export function redo(h: History): History {
  const next = h.future[0];
  if (next === undefined) return h;
  return { past: [...h.past, h.present], present: next, future: h.future.slice(1), limit: h.limit };
}
