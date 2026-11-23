"use client";

import { chassisToDxf, chassisToStl, designToKicadNetlist } from "@linelab/design-core";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { download, exportDesign, slug } from "./files";
import {
  chassisOf,
  lookup,
  useCanRedo,
  useCanUndo,
  useDesign,
  useEditor,
  type View,
} from "./store";

function Tool({
  children,
  onClick,
  disabled,
  pressed,
  label,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      className={`rounded-md border px-2 py-1 text-sm disabled:opacity-40 ${pressed ? "border-accent bg-accent/10 text-accent" : "border-border hover:border-accent"}`}
    >
      {children}
    </button>
  );
}

export default function Toolbar({
  onChassis,
  saveState,
}: {
  onChassis: () => void;
  saveState: string;
}) {
  const design = useDesign();
  const st = useEditor.getState();
  const view = useEditor((s) => s.view);
  const grid = useEditor((s) => s.gridMm);
  const showM = useEditor((s) => s.showMeasurements);
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const [name, setName] = useState<string | null>(null);
  const chassis = chassisOf(design);
  const base = slug(design.name);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
      <Link href="/build" className="text-sm text-muted hover:text-fg">
        ← Designs
      </Link>
      <input
        aria-label="Design name"
        value={name ?? design.name}
        onChange={(e) => {
          setName(e.target.value);
        }}
        onBlur={() => {
          if (name !== null && name.trim() !== "") st.rename(name.trim());
          setName(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="w-40 rounded-md border border-transparent bg-transparent px-1 py-1 text-sm font-medium hover:border-border focus:border-accent"
      />
      <span data-testid="save-state" className="text-xs text-muted">
        {saveState}
      </span>
      <div className="mx-1 h-5 w-px bg-border" />
      <Tool
        label="Undo (Ctrl+Z)"
        onClick={() => {
          st.undo();
        }}
        disabled={!canUndo}
      >
        ↶
      </Tool>
      <Tool
        label="Redo (Ctrl+Shift+Z)"
        onClick={() => {
          st.redo();
        }}
        disabled={!canRedo}
      >
        ↷
      </Tool>
      <div className="mx-1 h-5 w-px bg-border" />
      {(
        [
          ["orbit", "3D"],
          ["top", "Top"],
          ["side", "Side"],
          ["schematic", "Schematic"],
        ] as [View, string][]
      ).map(([v, l]) => (
        <Tool
          key={v}
          pressed={view === v}
          onClick={() => {
            st.setView(v);
          }}
        >
          {l}
        </Tool>
      ))}
      <label className="flex items-center gap-1 text-sm">
        <span className="text-muted">Snap</span>
        <select
          aria-label="Snap grid"
          value={grid}
          onChange={(e) => {
            st.setGrid(Number(e.target.value));
          }}
          className="rounded-md border border-border bg-bg px-1 py-1"
        >
          {[0, 1, 2.5, 5, 10].map((g) => (
            <option key={g} value={g}>
              {g === 0 ? "off" : `${g} mm`}
            </option>
          ))}
        </select>
      </label>
      <Tool
        pressed={showM}
        onClick={() => {
          st.toggleMeasurements();
        }}
      >
        Measurements
      </Tool>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Tool onClick={onChassis}>Chassis…</Tool>
        <Tool
          label="Download design as JSON"
          onClick={() => {
            download(`${base}.linelab.json`, exportDesign(design), "application/json");
          }}
        >
          Export JSON
        </Tool>
        <Tool
          label="Download the netlist for KiCad"
          onClick={() => {
            download(`${base}.net`, designToKicadNetlist(design, lookup), "text/plain");
          }}
        >
          KiCad
        </Tool>
        {chassis && (
          <>
            <Tool
              label="Download the chassis plate as DXF (laser cutting)"
              onClick={() => {
                download(`${base}-chassis.dxf`, chassisToDxf(chassis), "application/dxf");
              }}
            >
              DXF
            </Tool>
            <Tool
              label="Download the chassis plate as STL (3D printing)"
              onClick={() => {
                download(`${base}-chassis.stl`, chassisToStl(chassis), "model/stl");
              }}
            >
              STL
            </Tool>
          </>
        )}
      </div>
    </div>
  );
}
