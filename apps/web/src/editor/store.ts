"use client";

import { getChassis, getComponent } from "@linelab/component-db";
import {
  autoWire,
  canRedo,
  canUndo,
  createHistory,
  defaultPlacement,
  endGesture,
  execute,
  nextInstanceId,
  normalizeAngle,
  placementZ,
  quatFromYaw,
  redo,
  resolveChassis,
  snapPosition,
  undo,
  yawOf,
  type Command,
  type History,
  type PlacementPatch,
} from "@linelab/design-core";
import type { Chassis, Design, NetEndpoint, Placement } from "@linelab/schema";
import { create } from "zustand";

export type View = "orbit" | "top" | "side" | "schematic" | "code" | "run";
export type LeftPanel = "parts" | "wiring";

export const lookup = (id: string) => getComponent(id);
export const chassisOf = (d: Design): Chassis | undefined => resolveChassis(d, getChassis);

interface EditorState {
  history: History;
  selection: string[];
  gridMm: number;
  view: View;
  showMeasurements: boolean;
  /** Forces continuous rendering (used to measure frame rate). */
  perfMode: boolean;
  leftPanel: LeftPanel;
  /** First pin clicked in the wiring panel, waiting for the second. */
  pendingPin: NetEndpoint | null;

  load: (design: Design) => void;
  exec: (cmd: Command, opts?: { coalesceKey?: string }) => void;
  undo: () => void;
  redo: () => void;
  endGesture: () => void;
  select: (ids: string[], mode?: "replace" | "toggle") => void;
  addComponent: (componentId: string) => string | undefined;
  removeSelected: () => void;
  duplicateSelected: () => void;
  /** Moves parts to new centres. A single part is snapped (mounts, holes, edges, grid). */
  moveTo: (targets: { id: string; x: number; y: number }[], gestureKey: string) => void;
  nudge: (dx: number, dy: number) => void;
  rotateSelected: (deltaRad: number) => void;
  setYaw: (id: string, yawRad: number) => void;
  setPosition: (id: string, x: number, y: number) => void;
  setMounting: (
    id: string,
    m: { deck?: number; mount?: Placement["mount"]; standoffMm?: number },
  ) => void;
  setChassis: (chassis: Design["chassis"]) => void;
  rename: (name: string) => void;
  setGrid: (mm: number) => void;
  setView: (v: View) => void;
  toggleMeasurements: () => void;
  setPerfMode: (on: boolean) => void;
  setLeftPanel: (p: LeftPanel) => void;
  /** Click a pin: the first click picks it, the second connects the two. */
  clickPin: (e: NetEndpoint) => void;
  disconnectPin: (e: NetEndpoint) => void;
  renameNet: (id: string, name: string) => void;
  autoWire: () => void;
  clearWiring: () => void;
  /** Applies several commands as a single undo step (rules-engine fixes). */
  applyCommands: (cmds: Command[]) => void;
}

const EMPTY: Design = {
  id: "empty",
  name: "",
  version: 1,
  chassis: { kind: "template", chassisId: "chassis.starter-2wd" },
  placements: [],
  netlist: [],
};
let gestureCounter = 0;
export const newGestureKey = (kind: string) => `${kind}-${++gestureCounter}`;

export const useEditor = create<EditorState>()((set, get) => {
  const present = () => get().history.present;
  const exec = (cmd: Command, opts?: { coalesceKey?: string }) => {
    set((s) => ({ history: execute(s.history, cmd, opts) }));
  };
  /** Re-derives every part's height from its deck and mount (after a chassis or deck change). */
  const reseat = (d: Design, chassis: Chassis): Command | undefined => {
    const changes = d.placements.flatMap((p) => {
      const c = lookup(p.componentId);
      if (!c) return [];
      const deck = chassis.decks.some((k) => k.index === p.deck) ? p.deck : 0;
      const z = placementZ(chassis, c, deck, p.mount, p.standoffMm);
      return z === p.position.z && deck === p.deck
        ? []
        : [{ id: p.instanceId, patch: { deck, position: { ...p.position, z } } }];
    });
    return changes.length > 0 ? { type: "update", changes } : undefined;
  };

  return {
    history: createHistory(EMPTY),
    selection: [],
    gridMm: 5,
    view: "orbit",
    showMeasurements: true,
    perfMode: false,
    leftPanel: "parts",
    pendingPin: null,

    load: (design) => {
      set({ history: createHistory(design), selection: [] });
    },
    exec,
    undo: () => {
      set((s) => ({ history: undo(endGesture(s.history)), selection: s.selection }));
      const ids = new Set(present().placements.map((p) => p.instanceId));
      set((s) => ({ selection: s.selection.filter((id) => ids.has(id)) }));
    },
    redo: () => {
      set((s) => ({ history: redo(endGesture(s.history)) }));
      const ids = new Set(present().placements.map((p) => p.instanceId));
      set((s) => ({ selection: s.selection.filter((id) => ids.has(id)) }));
    },
    endGesture: () => {
      set((s) => ({ history: endGesture(s.history) }));
    },
    select: (ids, mode = "replace") => {
      set((s) => ({
        selection:
          mode === "replace"
            ? ids
            : [
                ...s.selection.filter((id) => !ids.includes(id)),
                ...ids.filter((id) => !s.selection.includes(id)),
              ],
      }));
    },
    addComponent: (componentId) => {
      const d = present();
      const c = lookup(componentId);
      const chassis = chassisOf(d);
      if (!c || !chassis) return undefined;
      const p = defaultPlacement(c, d, chassis, lookup);
      set((s) => ({
        history: execute(endGesture(s.history), { type: "add", placements: [p] }),
        selection: [p.instanceId],
      }));
      return p.instanceId;
    },
    removeSelected: () => {
      const ids = get().selection;
      if (ids.length === 0) return;
      set((s) => ({
        history: execute(endGesture(s.history), { type: "remove", ids }),
        selection: [],
      }));
    },
    duplicateSelected: () => {
      let d = present();
      const copies: Placement[] = [];
      for (const id of get().selection) {
        const p = d.placements.find((x) => x.instanceId === id);
        const c = p && lookup(p.componentId);
        if (!p || !c) continue;
        const copy: Placement = {
          ...p,
          instanceId: nextInstanceId(d, c),
          position: { ...p.position, x: p.position.x + 10, y: p.position.y - 10 },
        };
        copies.push(copy);
        d = { ...d, placements: [...d.placements, copy] };
      }
      if (copies.length === 0) return;
      set((s) => ({
        history: execute(endGesture(s.history), { type: "add", placements: copies }),
        selection: copies.map((c) => c.instanceId),
      }));
    },
    moveTo: (targets, gestureKey) => {
      const d = present();
      const chassis = chassisOf(d);
      if (!chassis) return;
      const { gridMm } = get();
      const changes: { id: string; patch: PlacementPatch }[] = [];
      for (const t of targets) {
        const p = d.placements.find((x) => x.instanceId === t.id);
        const c = p && lookup(p.componentId);
        if (!p || !c) continue;
        let x = t.x;
        let y = t.y;
        if (targets.length === 1) {
          const s = snapPosition({ x, y }, c, yawOf(p.rotation), chassis, { gridMm });
          x = s.x;
          y = s.y;
        } else if (gridMm > 0) {
          x = Math.round(x / gridMm) * gridMm;
          y = Math.round(y / gridMm) * gridMm;
        }
        if (Math.abs(x - p.position.x) > 1e-6 || Math.abs(y - p.position.y) > 1e-6) {
          changes.push({ id: t.id, patch: { position: { x, y, z: p.position.z } } });
        }
      }
      if (changes.length > 0) exec({ type: "update", changes }, { coalesceKey: gestureKey });
    },
    nudge: (dx, dy) => {
      const d = present();
      const ids = new Set(get().selection);
      const changes = d.placements
        .filter((p) => ids.has(p.instanceId))
        .map((p) => ({
          id: p.instanceId,
          patch: { position: { ...p.position, x: p.position.x + dx, y: p.position.y + dy } },
        }));
      if (changes.length > 0)
        set((s) => ({ history: execute(endGesture(s.history), { type: "update", changes }) }));
    },
    rotateSelected: (delta) => {
      const d = present();
      const ids = new Set(get().selection);
      const changes = d.placements
        .filter((p) => ids.has(p.instanceId))
        .map((p) => ({
          id: p.instanceId,
          patch: { rotation: quatFromYaw(normalizeAngle(yawOf(p.rotation) + delta)) },
        }));
      if (changes.length > 0)
        set((s) => ({ history: execute(endGesture(s.history), { type: "update", changes }) }));
    },
    setYaw: (id, yaw) => {
      set((s) => ({
        history: execute(endGesture(s.history), {
          type: "update",
          changes: [{ id, patch: { rotation: quatFromYaw(normalizeAngle(yaw)) } }],
        }),
      }));
    },
    setPosition: (id, x, y) => {
      const p = present().placements.find((q) => q.instanceId === id);
      if (!p) return;
      set((s) => ({
        history: execute(endGesture(s.history), {
          type: "update",
          changes: [{ id, patch: { position: { x, y, z: p.position.z } } }],
        }),
      }));
    },
    setMounting: (id, m) => {
      const d = present();
      const chassis = chassisOf(d);
      const p = d.placements.find((q) => q.instanceId === id);
      const c = p && lookup(p.componentId);
      if (!chassis || !p || !c) return;
      const deck = m.deck ?? p.deck;
      const mount = m.mount ?? p.mount;
      const standoffMm = Math.max(0, m.standoffMm ?? p.standoffMm);
      const z = placementZ(chassis, c, deck, mount, standoffMm);
      set((s) => ({
        history: execute(endGesture(s.history), {
          type: "update",
          changes: [{ id, patch: { deck, mount, standoffMm, position: { ...p.position, z } } }],
        }),
      }));
    },
    setChassis: (chassisRef) => {
      const key = newGestureKey("chassis");
      set((s) => ({
        history: execute(
          endGesture(s.history),
          { type: "set-chassis", chassis: chassisRef },
          { coalesceKey: key },
        ),
      }));
      const d = present();
      const chassis = chassisOf(d);
      const fix = chassis && reseat(d, chassis);
      if (fix) exec(fix, { coalesceKey: key });
      get().endGesture();
    },
    rename: (name) => {
      if (name === present().name) return;
      set((s) => ({ history: execute(endGesture(s.history), { type: "rename", name }) }));
    },
    setGrid: (gridMm) => {
      set({ gridMm });
    },
    setView: (view) => {
      set({ view });
    },
    toggleMeasurements: () => {
      set((s) => ({ showMeasurements: !s.showMeasurements }));
    },
    setPerfMode: (perfMode) => {
      set({ perfMode });
    },
    setLeftPanel: (leftPanel) => {
      set({ leftPanel, pendingPin: null });
    },
    clickPin: (e) => {
      const pending = get().pendingPin;
      if (!pending) {
        set({ pendingPin: e });
        return;
      }
      if (pending.instanceId === e.instanceId && pending.pinId === e.pinId) {
        set({ pendingPin: null });
        return;
      }
      set((s) => ({
        history: execute(endGesture(s.history), { type: "connect", a: pending, b: e }),
        pendingPin: null,
      }));
    },
    disconnectPin: (e) => {
      set((s) => ({
        history: execute(endGesture(s.history), { type: "disconnect", endpoint: e }),
      }));
    },
    renameNet: (id, name) => {
      if (name.trim() === "") return;
      set((s) => ({
        history: execute(endGesture(s.history), { type: "rename-net", id, name: name.trim() }),
      }));
    },
    autoWire: () => {
      const d = present();
      set((s) => ({
        history: execute(endGesture(s.history), {
          type: "set-netlist",
          netlist: autoWire(d, lookup),
        }),
        pendingPin: null,
      }));
    },
    clearWiring: () => {
      set((s) => ({
        history: execute(endGesture(s.history), { type: "set-netlist", netlist: [] }),
        pendingPin: null,
      }));
    },
    applyCommands: (cmds) => {
      const key = newGestureKey("fix");
      let h = endGesture(get().history);
      for (const c of cmds) h = execute(h, c, { coalesceKey: key });
      set({ history: endGesture(h) });
    },
  };
});

export const useDesign = () => useEditor((s) => s.history.present);
export const useCanUndo = () => useEditor((s) => canUndo(s.history));
export const useCanRedo = () => useEditor((s) => canRedo(s.history));
