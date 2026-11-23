"use client";

import { CHASSIS } from "@linelab/component-db";
import {
  MATERIAL_DENSITY_GCM3,
  area,
  buildOutline,
  chassisMassProps,
  makeCustomChassis,
  parseDxfOutline,
  parseStlOutline,
  parseSvgOutline,
  type OutlinePreset,
} from "@linelab/design-core";
import type { Chassis, Polygon, Vec2 } from "@linelab/schema";
import { useEffect, useMemo, useRef, useState } from "react";
import { OutlineSvg } from "./outline-svg";
import { chassisOf, useDesign, useEditor } from "./store";

const MATERIALS = Object.keys(MATERIAL_DENSITY_GCM3) as Chassis["material"][];

function Num({
  label,
  value,
  onChange,
  step = 1,
  min,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="w-24 rounded-md border border-border bg-bg px-2 py-1 text-right"
      />
    </label>
  );
}

interface Form {
  outline: Polygon;
  cutouts: Polygon[];
  importedHoles?: Vec2[];
  holeDiameterMm?: number;
  thicknessMm: number;
  material: Chassis["material"];
  deckHeightMm: number;
  trackHalfMm: number;
  axleHeightMm: number;
  casterX: string;
  holePitchMm: number;
}

function formFrom(c: Chassis): Form {
  const left = c.wheelMounts.find((w) => w.side === "left");
  return {
    outline: c.outline,
    cutouts: c.cutouts ?? [],
    thicknessMm: c.thicknessMm,
    material: c.material,
    deckHeightMm: c.decks[0]?.heightMm ?? 20,
    trackHalfMm: left ? Math.abs(left.position.y) : 45,
    axleHeightMm: left?.axleHeightMm ?? 16,
    casterX: c.casterMounts.map((m) => m.x).join(", "),
    holePitchMm: 10,
  };
}

function build(f: Form, id: string): Chassis {
  const casters = f.casterX
    .split(/[,\s]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n !== 0)
    .map((x) => ({ x, y: 0 }));
  return makeCustomChassis({
    id,
    name: "Custom chassis",
    outline: f.outline,
    cutouts: f.cutouts,
    thicknessMm: f.thicknessMm,
    material: f.material,
    deckHeightMm: f.deckHeightMm,
    trackHalfMm: f.trackHalfMm,
    axleHeightMm: f.axleHeightMm,
    casterMounts: casters,
    holePitchMm: f.holePitchMm,
    ...(f.importedHoles ? { mountPoints: f.importedHoles } : {}),
    ...(f.holeDiameterMm ? { mountHoleDiameterMm: f.holeDiameterMm } : {}),
  });
}

export default function ChassisDialog({ onClose }: { onClose: () => void }) {
  const design = useDesign();
  const current = chassisOf(design);
  const setChassis = useEditor((s) => s.setChassis);
  const [tab, setTab] = useState<"templates" | "custom">(
    design.chassis.kind === "custom" ? "custom" : "templates",
  );
  const [form, setForm] = useState<Form>(() => formFrom(current ?? (CHASSIS[0] as Chassis)));
  const [preset, setPreset] = useState({
    preset: "t-nose" as OutlinePreset,
    lengthMm: 70,
    widthMm: 80,
    rearOverhangMm: 30,
    noseLengthMm: 70,
    noseWidthMm: 20,
    cornerRadiusMm: 4,
  });
  const [message, setMessage] = useState<string>("");
  const dialog = useRef<HTMLDivElement>(null);
  const preview = useMemo(() => build(form, `chassis.custom-${design.id}`), [form, design.id]);
  const stats = useMemo(() => chassisMassProps(preview), [preview]);

  useEffect(() => {
    dialog.current?.focus();
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  async function onImport(file: File) {
    try {
      const name = file.name.toLowerCase();
      if (name.endsWith(".stl")) {
        const r = parseStlOutline(await file.arrayBuffer());
        setForm((f) => ({
          ...f,
          outline: r.outline,
          cutouts: [],
          thicknessMm: r.thicknessMm || f.thicknessMm,
          importedHoles: undefined,
        }));
        setMessage(r.warnings.join(" "));
      } else {
        const text = await file.text();
        const r = name.endsWith(".svg") ? parseSvgOutline(text) : parseDxfOutline(text);
        setForm((f) => ({
          ...f,
          outline: r.outline,
          cutouts: r.cutouts,
          importedHoles: r.holes.length > 0 ? r.holes : undefined,
          holeDiameterMm: r.holeDiameterMm,
        }));
        setMessage(
          `Imported ${file.name}: ${r.cutouts.length} cutout(s), ${r.holes.length} hole(s).${r.warnings.length ? ` ${r.warnings.join(" ")}` : ""}`,
        );
      }
    } catch (err) {
      setMessage(`Could not import ${file.name}: ${(err as Error).message}`);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-6">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chassis-title"
        tabIndex={-1}
        className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl outline-none"
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <h2 id="chassis-title" className="font-semibold">
            Chassis
          </h2>
          <div role="tablist" className="flex gap-1">
            {(["templates", "custom"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => {
                  setTab(t);
                }}
                className={`rounded-md px-3 py-1 text-sm ${tab === t ? "bg-accent text-white dark:text-black" : "hover:bg-bg"}`}
              >
                {t === "templates" ? "Templates" : "Custom"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded-md px-2 py-1 text-lg leading-none hover:bg-bg"
          >
            ×
          </button>
        </div>

        {tab === "templates" ? (
          <ul className="grid gap-3 overflow-y-auto p-4 sm:grid-cols-2 lg:grid-cols-3">
            {CHASSIS.map((c) => {
              const on = design.chassis.kind === "template" && design.chassis.chassisId === c.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setChassis({ kind: "template", chassisId: c.id });
                      onClose();
                    }}
                    className={`flex h-full w-full flex-col rounded-lg border p-3 text-left hover:border-accent ${on ? "border-accent" : "border-border"}`}
                  >
                    <OutlineSvg chassis={c} className="h-28 w-full" title={`${c.name} outline`} />
                    <span className="mt-2 text-sm font-medium">{c.name}</span>
                    <span className="text-xs text-muted">{c.inspiredBy}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="grid min-h-0 gap-4 overflow-y-auto p-4 md:grid-cols-[1fr_18rem]">
            <div className="min-w-0">
              <OutlineSvg
                chassis={preview}
                onChange={(outline) => {
                  setForm((f) => ({ ...f, outline }));
                }}
                className="h-[22rem] w-full rounded-lg border border-border bg-bg"
                title="Editable chassis outline: drag the dots, double-click an edge to add a point, select a dot and press Delete to remove it"
              />
              <p className="mt-2 text-xs text-muted">
                Front is up. Drag the dots; double-click an edge to add a point; select a dot and
                press Delete to remove it. Grey bars are wheels, rings are casters.
              </p>
              {message && (
                <p role="status" className="mt-2 text-sm">
                  {message}
                </p>
              )}
            </div>
            <div className="space-y-3">
              <fieldset className="space-y-2 rounded-lg border border-border p-3">
                <legend className="px-1 text-sm font-medium">Start from a shape</legend>
                <select
                  aria-label="Outline preset"
                  value={preset.preset}
                  onChange={(e) => {
                    setPreset((p) => ({ ...p, preset: e.target.value as OutlinePreset }));
                  }}
                  className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm"
                >
                  <option value="t-nose">T-nose (sensor bar on a neck)</option>
                  <option value="rectangle">Rectangle</option>
                  <option value="octagon">Octagon</option>
                </select>
                <Num
                  label="Body length"
                  value={preset.lengthMm}
                  onChange={(v) => {
                    setPreset((p) => ({ ...p, lengthMm: v }));
                  }}
                />
                <Num
                  label="Body width"
                  value={preset.widthMm}
                  onChange={(v) => {
                    setPreset((p) => ({ ...p, widthMm: v }));
                  }}
                />
                <Num
                  label="Behind axle"
                  value={preset.rearOverhangMm}
                  onChange={(v) => {
                    setPreset((p) => ({ ...p, rearOverhangMm: v }));
                  }}
                />
                {preset.preset === "t-nose" && (
                  <>
                    <Num
                      label="Neck length"
                      value={preset.noseLengthMm}
                      onChange={(v) => {
                        setPreset((p) => ({ ...p, noseLengthMm: v }));
                      }}
                    />
                    <Num
                      label="Neck width"
                      value={preset.noseWidthMm}
                      onChange={(v) => {
                        setPreset((p) => ({ ...p, noseWidthMm: v }));
                      }}
                    />
                  </>
                )}
                <Num
                  label="Corner radius"
                  value={preset.cornerRadiusMm}
                  min={0}
                  onChange={(v) => {
                    setPreset((p) => ({ ...p, cornerRadiusMm: v }));
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setForm((f) => ({
                      ...f,
                      outline: buildOutline({
                        ...preset,
                        barWidthMm: preset.widthMm,
                        barDepthMm: 15,
                      }),
                      cutouts: [],
                      importedHoles: undefined,
                    }));
                    setMessage("");
                  }}
                  className="w-full rounded-md border border-border py-1 text-sm hover:border-accent"
                >
                  Use this shape
                </button>
                <label className="block text-sm">
                  <span className="text-muted">…or import SVG / DXF / STL</span>
                  <input
                    type="file"
                    aria-label="Import chassis outline"
                    accept=".svg,.dxf,.stl"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void onImport(file);
                      e.target.value = "";
                    }}
                    className="mt-1 block w-full text-xs"
                  />
                </label>
              </fieldset>
              <fieldset className="space-y-2 rounded-lg border border-border p-3">
                <legend className="px-1 text-sm font-medium">Plate and mounts</legend>
                <label className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted">Material</span>
                  <select
                    value={form.material}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, material: e.target.value as Chassis["material"] }));
                    }}
                    className="w-28 rounded-md border border-border bg-bg px-1 py-1"
                  >
                    {MATERIALS.map((m) => (
                      <option key={m} value={m}>
                        {m.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <Num
                  label="Thickness mm"
                  value={form.thicknessMm}
                  step={0.1}
                  onChange={(v) => {
                    setForm((f) => ({ ...f, thicknessMm: v }));
                  }}
                />
                <Num
                  label="Deck top above ground"
                  value={form.deckHeightMm}
                  step={0.1}
                  onChange={(v) => {
                    setForm((f) => ({ ...f, deckHeightMm: v }));
                  }}
                />
                <Num
                  label="Wheel Y (±)"
                  value={form.trackHalfMm}
                  step={0.5}
                  onChange={(v) => {
                    setForm((f) => ({ ...f, trackHalfMm: v }));
                  }}
                />
                <Num
                  label="Axle height"
                  value={form.axleHeightMm}
                  step={0.5}
                  onChange={(v) => {
                    setForm((f) => ({ ...f, axleHeightMm: v }));
                  }}
                />
                <label className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted">Caster X list</span>
                  <input
                    value={form.casterX}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, casterX: e.target.value }));
                    }}
                    placeholder="e.g. 110, -40"
                    className="w-28 rounded-md border border-border bg-bg px-2 py-1 text-right"
                  />
                </label>
                {!form.importedHoles && (
                  <Num
                    label="Hole grid pitch"
                    value={form.holePitchMm}
                    onChange={(v) => {
                      setForm((f) => ({ ...f, holePitchMm: v }));
                    }}
                  />
                )}
              </fieldset>
              <dl className="space-y-1 text-sm" data-testid="custom-chassis-stats">
                <div className="flex justify-between">
                  <dt className="text-muted">Plate area</dt>
                  <dd>{`${(area(preview.outline) / 100).toFixed(1)} cm²`}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Plate mass</dt>
                  <dd data-testid="custom-chassis-mass">{`${stats.massG.toFixed(1)} g`}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Plate CoG (x, y)</dt>
                  <dd>{`${stats.cog.x.toFixed(1)}, ${stats.cog.y.toFixed(1)} mm`}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Mounting holes</dt>
                  <dd>{preview.mountPoints.length}</dd>
                </div>
              </dl>
              <button
                type="button"
                onClick={() => {
                  setChassis({ kind: "custom", chassis: preview });
                  onClose();
                }}
                className="w-full rounded-lg bg-accent py-2 text-sm font-medium text-white dark:text-black"
              >
                Apply custom chassis
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
