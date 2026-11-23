"use client";

import { designMassProps, findCollisions, measure, yawOf } from "@linelab/design-core";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import Checks from "./checks";
import { chassisOf, lookup, useDesign, useEditor } from "./store";

const mm = (v: number) => `${v.toFixed(1)} mm`;

function NumberField({
  label,
  value,
  step,
  onCommit,
}: {
  label: string;
  value: number;
  step: number;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(Math.round(value * 100) / 100);
  const commit = () => {
    if (draft === null) return;
    const v = Number(draft);
    setDraft(null);
    if (Number.isFinite(v)) onCommit(v);
  };
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted">{label}</span>
      <input
        type="number"
        step={step}
        value={shown}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        className="w-24 rounded-md border border-border bg-bg px-2 py-1 text-right"
      />
    </label>
  );
}

function Row({ k, children, testId }: { k: string; children: ReactNode; testId?: string }) {
  return (
    <div className="flex justify-between gap-2 py-1 text-sm">
      <dt className="text-muted">{k}</dt>
      <dd data-testid={testId} className="text-right">
        {children}
      </dd>
    </div>
  );
}

function Selection() {
  const design = useDesign();
  const chassis = chassisOf(design);
  const selection = useEditor((s) => s.selection);
  const st = useEditor.getState();
  const gridMm = useEditor((s) => s.gridMm);

  if (selection.length === 0) {
    return (
      <p className="text-sm text-muted">
        Click a part to select it. Shift-click adds to the selection.
      </p>
    );
  }
  if (selection.length > 1) {
    return (
      <div className="space-y-2">
        <p className="text-sm">{selection.length} parts selected</p>
        <div className="flex flex-wrap gap-2">
          <Btn
            onClick={() => {
              st.rotateSelected(Math.PI / 2);
            }}
          >
            Rotate 90°
          </Btn>
          <Btn
            onClick={() => {
              st.duplicateSelected();
            }}
          >
            Duplicate
          </Btn>
          <Btn
            danger
            onClick={() => {
              st.removeSelected();
            }}
          >
            Delete
          </Btn>
        </div>
      </div>
    );
  }
  const p = design.placements.find((x) => x.instanceId === selection[0]);
  const c = p && lookup(p.componentId);
  if (!p || !c || !chassis) return null;
  const yawDeg = (yawOf(p.rotation) * 180) / Math.PI;
  return (
    <div className="space-y-2" data-testid="inspector-selection">
      <p className="text-sm font-medium">
        <Link href={`/components/${c.id}`} target="_blank" className="hover:text-accent">
          {c.name}
        </Link>
      </p>
      <p className="font-mono text-xs text-muted">{p.instanceId}</p>
      <NumberField
        label="X (forward) mm"
        value={p.position.x}
        step={gridMm || 0.5}
        onCommit={(v) => {
          st.setPosition(p.instanceId, v, p.position.y);
        }}
      />
      <NumberField
        label="Y (left) mm"
        value={p.position.y}
        step={gridMm || 0.5}
        onCommit={(v) => {
          st.setPosition(p.instanceId, p.position.x, v);
        }}
      />
      <NumberField
        label="Rotation °"
        value={yawDeg}
        step={15}
        onCommit={(v) => {
          st.setYaw(p.instanceId, (v * Math.PI) / 180);
        }}
      />
      {c.category !== "wheel" && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted">Mounted</span>
          <div className="flex gap-1">
            {chassis.decks.length > 1 && (
              <select
                aria-label="Deck"
                value={p.deck}
                onChange={(e) => {
                  st.setMounting(p.instanceId, { deck: Number(e.target.value) });
                }}
                className="rounded-md border border-border bg-bg px-1 py-1"
              >
                {chassis.decks.map((d) => (
                  <option key={d.index} value={d.index}>
                    Deck {d.index}
                  </option>
                ))}
              </select>
            )}
            {(["top", "bottom"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={p.mount === m}
                onClick={() => {
                  st.setMounting(p.instanceId, { mount: m });
                }}
                className={`rounded-md border px-2 py-1 ${p.mount === m ? "border-accent text-accent" : "border-border"}`}
              >
                {m === "top" ? "On top" : "Underneath"}
              </button>
            ))}
          </div>
        </div>
      )}
      {c.category !== "wheel" && (
        <NumberField
          label={p.mount === "top" ? "Spacer below, mm" : "Spacer above, mm"}
          value={p.standoffMm}
          step={1}
          onCommit={(v) => {
            st.setMounting(p.instanceId, { standoffMm: v });
          }}
        />
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <Btn
          onClick={() => {
            st.rotateSelected(Math.PI / 2);
          }}
        >
          Rotate 90°
        </Btn>
        <Btn
          onClick={() => {
            st.duplicateSelected();
          }}
        >
          Duplicate
        </Btn>
        <Btn
          danger
          onClick={() => {
            st.removeSelected();
          }}
        >
          Delete
        </Btn>
      </div>
    </div>
  );
}

function Btn({
  children,
  onClick,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2 py-1 text-xs font-medium ${danger ? "border-red-500/50 text-red-600 hover:bg-red-500/10" : "border-border hover:border-accent"}`}
    >
      {children}
    </button>
  );
}

function Analysis() {
  const design = useDesign();
  const chassis = chassisOf(design);
  const select = useEditor((s) => s.select);
  const data = useMemo(() => {
    if (!chassis) return undefined;
    return {
      mass: designMassProps(design, chassis, lookup),
      m: measure(design, chassis, lookup),
      collisions: findCollisions(design, chassis, lookup),
    };
  }, [design, chassis]);
  if (!data) return null;
  const { mass, m, collisions } = data;
  const opt = m.sensorOptimalMm;
  const clearanceNote =
    m.sensorClearanceMm === undefined || !opt
      ? ""
      : m.sensorClearanceMm < opt.min
        ? " · too low"
        : m.sensorClearanceMm > opt.max
          ? " · too high"
          : " · in range";
  const axle = m.driveAxleX;
  return (
    <div className="space-y-4">
      <dl className="divide-y divide-border">
        <Row k="Total mass" testId="mass-total">{`${mass.massG.toFixed(1)} g`}</Row>
        <Row k="Chassis plate" testId="mass-chassis">{`${mass.chassis.massG.toFixed(1)} g`}</Row>
        <Row
          k="Centre of gravity"
          testId="cog"
        >{`${mass.cog.x.toFixed(1)}, ${mass.cog.y.toFixed(1)}, ${mass.cog.z.toFixed(1)}`}</Row>
        {axle !== undefined && <Row k="CoG ahead of axle">{mm(mass.cog.x - axle)}</Row>}
        <Row k="Track width" testId="track-width">
          {m.trackWidthMm !== undefined ? mm(m.trackWidthMm) : "—"}
        </Row>
        <Row k="Wheelbase">{m.wheelbaseMm !== undefined ? mm(m.wheelbaseMm) : "—"}</Row>
        <Row k="Sensor look-ahead" testId="lookahead">
          {m.lookaheadMm !== undefined ? mm(m.lookaheadMm) : "—"}
        </Row>
        <Row k="Sensor height" testId="sensor-height">
          {m.sensorClearanceMm !== undefined ? `${mm(m.sensorClearanceMm)}${clearanceNote}` : "—"}
          {opt && (
            <span className="block text-xs text-muted">{`ideal ${opt.min}–${opt.max} mm`}</span>
          )}
        </Row>
        {m.casterGapsMm.map((g) => (
          <Row key={g.instanceId} k={`${g.instanceId} to ground`}>
            {Math.abs(g.gapMm) < 0.5
              ? "touching"
              : g.gapMm > 0
                ? `${mm(g.gapMm)} gap`
                : `${mm(-g.gapMm)} too tall`}
          </Row>
        ))}
      </dl>
      <div>
        <h3 className="text-sm font-semibold">
          Collisions{" "}
          <span data-testid="collision-count" className="font-normal text-muted">
            {collisions.length}
          </span>
        </h3>
        {collisions.length === 0 ? (
          <p className="text-sm text-muted">No parts overlap.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {collisions.map((c) => (
              <li key={`${c.a}-${c.b}`}>
                <button
                  type="button"
                  onClick={() => {
                    select(c.b.startsWith("chassis:") ? [c.a] : [c.a, c.b]);
                  }}
                  className="text-left text-sm text-red-600 hover:underline"
                >
                  {c.b.startsWith("chassis:")
                    ? `${c.a} passes through deck ${c.b.slice(8)}`
                    : `${c.a} overlaps ${c.b}`}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-muted">
        Coordinates in mm: X forward, Y left, Z up; origin at the drive-axle centre on the ground.
      </p>
    </div>
  );
}

export default function Inspector() {
  return (
    <div className="space-y-5 p-3">
      <section aria-labelledby="sel-heading">
        <h2 id="sel-heading" className="mb-2 text-sm font-semibold">
          Selection
        </h2>
        <Selection />
      </section>
      <Checks />
      <section aria-labelledby="analysis-heading">
        <h2 id="analysis-heading" className="mb-1 text-sm font-semibold">
          Robot
        </h2>
        <Analysis />
      </section>
    </div>
  );
}
