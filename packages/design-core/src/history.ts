import type { Design, DesignCommand, Net, NetEndpoint, PlacementPatch } from "@linelab/schema";

export type { PlacementPatch };
/** Every change to a design is one of these (defined as a Zod schema in @linelab/schema). */
export type Command = DesignCommand;

const key = (e: NetEndpoint) => `${e.instanceId}/${e.pinId}`;

/** Drops nets that no longer join at least two pins. */
const prune = (nets: Net[]) => nets.filter((n) => n.connections.length >= 2);

function nextNetId(nets: readonly Net[]): string {
  const used = new Set(nets.map((n) => n.id));
  for (let i = 1; ; i++) if (!used.has(`n${i}`)) return `n${i}`;
}

/** Pure netlist edit: join pins a and b, creating or merging nets. */
export function connectPins(
  netlist: readonly Net[],
  a: NetEndpoint,
  b: NetEndpoint,
  nameHint?: string,
): Net[] {
  if (key(a) === key(b)) return [...netlist];
  const na = netlist.find((n) => n.connections.some((c) => key(c) === key(a)));
  const nb = netlist.find((n) => n.connections.some((c) => key(c) === key(b)));
  if (na && nb && na.id === nb.id) return [...netlist];
  if (!na && !nb) {
    return [
      ...netlist,
      {
        id: nextNetId(netlist),
        name: nameHint ?? `${a.instanceId}.${a.pinId}`,
        connections: [a, b],
      },
    ];
  }
  if (na && !nb)
    return netlist.map((n) => (n.id === na.id ? { ...n, connections: [...n.connections, b] } : n));
  if (!na && nb)
    return netlist.map((n) => (n.id === nb.id ? { ...n, connections: [...n.connections, a] } : n));
  // Merge b's net into a's net.
  const A = na as Net;
  const B = nb as Net;
  const named = /^(n\d+|.+\..+)$/.test(A.name) && !/^(n\d+|.+\..+)$/.test(B.name) ? B.name : A.name;
  return netlist
    .filter((n) => n.id !== B.id)
    .map((n) =>
      n.id === A.id ? { ...n, name: named, connections: [...n.connections, ...B.connections] } : n,
    );
}

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
        netlist: prune(
          design.netlist.map((n) => ({
            ...n,
            connections: n.connections.filter((c) => !ids.has(c.instanceId)),
          })),
        ),
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
    case "connect": {
      const ids = new Set(design.placements.map((p) => p.instanceId));
      for (const e of [cmd.a, cmd.b]) {
        if (!ids.has(e.instanceId)) throw new Error(`connect: unknown instance "${e.instanceId}"`);
      }
      return { ...design, netlist: connectPins(design.netlist, cmd.a, cmd.b) };
    }
    case "disconnect":
      return {
        ...design,
        netlist: prune(
          design.netlist.map((n) => ({
            ...n,
            connections: n.connections.filter((c) => key(c) !== key(cmd.endpoint)),
          })),
        ),
      };
    case "rename-net":
      if (!design.netlist.some((n) => n.id === cmd.id))
        throw new Error(`rename-net: unknown net "${cmd.id}"`);
      return {
        ...design,
        netlist: design.netlist.map((n) => (n.id === cmd.id ? { ...n, name: cmd.name } : n)),
      };
    case "set-netlist":
      return { ...design, netlist: prune(cmd.netlist) };
    case "set-calibration": {
      const { calibration: _old, ...rest } = design;
      return cmd.calibration ? { ...rest, calibration: cmd.calibration } : rest;
    }
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
