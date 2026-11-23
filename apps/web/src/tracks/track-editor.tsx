"use client";

import { TrackBuilder, validateTrackGeometry } from "@linelab/sim-core";
import { Track } from "@linelab/schema";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { download, slug } from "../editor/files";
import { loadTrack, newTrackId, saveTrack, type Step } from "./storage";
import { TrackSvg, trackStats } from "./track-svg";

const DEFAULT_STEPS: Step[] = [
  { kind: "forward", mm: 800 },
  { kind: "turn", deg: 180, radiusMm: 250 },
  { kind: "forward", mm: 800 },
  { kind: "turn", deg: 180, radiusMm: 250 },
];

interface Meta {
  name: string;
  lineWidthMm: number;
  difficulty: NonNullable<Track["difficulty"]>;
  whiteLine: boolean;
}

function buildFromSteps(id: string, meta: Meta, steps: Step[]): Track {
  const b = new TrackBuilder({ x: 0, y: 0, headingRad: 0 });
  for (const s of steps) {
    if (s.kind === "forward") b.forward(s.mm);
    else if (s.kind === "turn") b.turn(s.deg, s.radiusMm);
    else if (s.kind === "gap") b.gapNext(s.mm);
    else b.invertNext(s.mm);
  }
  const t = b.build(
    {
      id,
      name: meta.name || "Untitled track",
      difficulty: meta.difficulty,
      lineWidthMm: meta.lineWidthMm,
      surface: meta.whiteLine
        ? {
            lineColor: "#f5f5f0",
            backgroundColor: "#111111",
            lineReflectance: 0.85,
            backgroundReflectance: 0.05,
          }
        : {
            lineColor: "#111111",
            backgroundColor: "#f5f5f0",
            lineReflectance: 0.05,
            backgroundReflectance: 0.85,
          },
    },
    { x: 0, y: 0, headingRad: 0 },
  );
  // Open courses get a finish marker where the path ends.
  const end = b.pose;
  if (Math.hypot(end.x, end.y) > 1) t.finish = end;
  return t;
}

function NumberInput({
  label,
  value,
  onChange,
  min,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
}) {
  return (
    <label className="flex items-center gap-1 text-xs">
      <span className="text-muted">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="w-20 rounded border border-border bg-bg px-1 py-0.5 text-right"
      />
    </label>
  );
}

export default function TrackEditor() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("id");
  const [trackId, setTrackId] = useState<string>(() => id ?? newTrackId());
  const [meta, setMeta] = useState<Meta>({
    name: "My track",
    lineWidthMm: 19,
    difficulty: "medium",
    whiteLine: false,
  });
  const [steps, setSteps] = useState<Step[] | null>(id ? null : DEFAULT_STEPS);
  const [fixed, setFixed] = useState<Track | null>(null); // imported/copied tracks without steps
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!id) return;
    void loadTrack(id).then((saved) => {
      if (!saved) {
        setStatus("Track not found in this browser; starting a new one.");
        setSteps(DEFAULT_STEPS);
        setTrackId(newTrackId());
        return;
      }
      setMeta({
        name: saved.track.name,
        lineWidthMm: saved.track.lineWidthMm,
        difficulty: saved.track.difficulty ?? "medium",
        whiteLine: saved.track.surface.lineReflectance > saved.track.surface.backgroundReflectance,
      });
      if (saved.steps) setSteps(saved.steps);
      else setFixed(saved.track);
    });
  }, [id]);

  const track = useMemo<Track | null>(() => {
    if (steps) return buildFromSteps(trackId, meta, steps);
    if (fixed)
      return {
        ...fixed,
        name: meta.name,
        lineWidthMm: meta.lineWidthMm,
        difficulty: meta.difficulty,
      };
    return null;
  }, [steps, fixed, meta, trackId]);
  const problems = useMemo(() => {
    if (!track) return [];
    const schema = Track.safeParse(track);
    return [
      ...(schema.success
        ? []
        : schema.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)),
      ...validateTrackGeometry(track).map((p) => p.message),
    ];
  }, [track]);

  if (!track) return <p className="p-6 text-sm text-muted">Loading track…</p>;
  const stats = trackStats(track);
  const update = (i: number, s: Step) => {
    setSteps((xs) => (xs ? xs.map((x, j) => (j === i ? s : x)) : xs));
  };

  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[22rem_1fr]">
      <section aria-labelledby="track-editor-heading" className="space-y-4">
        <p className="text-sm">
          <Link href="/tracks" className="text-muted hover:text-fg">
            ← Tracks
          </Link>
        </p>
        <h1 id="track-editor-heading" className="text-2xl font-bold">
          Track editor
        </h1>
        <label className="block text-sm">
          <span className="text-muted">Name</span>
          <input
            aria-label="Track name"
            value={meta.name}
            onChange={(e) => {
              setMeta({ ...meta, name: e.target.value });
            }}
            className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <NumberInput
            label="Line width (mm)"
            value={meta.lineWidthMm}
            min={5}
            onChange={(v) => {
              setMeta({ ...meta, lineWidthMm: v });
            }}
          />
          <label className="flex items-center gap-1 text-xs">
            <span className="text-muted">Difficulty</span>
            <select
              aria-label="Difficulty"
              value={meta.difficulty}
              onChange={(e) => {
                setMeta({ ...meta, difficulty: e.target.value as Meta["difficulty"] });
              }}
              className="rounded border border-border bg-bg px-1 py-0.5"
            >
              {["easy", "medium", "hard", "expert"].map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={meta.whiteLine}
              onChange={(e) => {
                setMeta({ ...meta, whiteLine: e.target.checked });
              }}
            />
            White line on black
          </label>
        </div>

        {steps ? (
          <div>
            <h2 className="text-sm font-semibold">Steps</h2>
            <p className="text-xs text-muted">
              Walk the line from the start: go forward, turn along arcs (positive degrees turn
              left). Gap and invert apply to the next stretch.
            </p>
            <ol className="mt-2 space-y-1" data-testid="steps">
              {steps.map((s, i) => (
                <li
                  key={i}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2 py-1"
                >
                  <span className="w-5 text-xs text-muted">{i + 1}</span>
                  <select
                    aria-label={`Step ${i + 1} type`}
                    value={s.kind}
                    onChange={(e) => {
                      const k = e.target.value as Step["kind"];
                      update(
                        i,
                        k === "turn"
                          ? { kind: "turn", deg: 90, radiusMm: 200 }
                          : { kind: k, mm: k === "forward" ? 300 : 50 },
                      );
                    }}
                    className="rounded border border-border bg-bg px-1 py-0.5 text-xs"
                  >
                    <option value="forward">Forward</option>
                    <option value="turn">Turn</option>
                    <option value="gap">Gap next</option>
                    <option value="invert">Invert next</option>
                  </select>
                  {s.kind === "turn" ? (
                    <>
                      <NumberInput
                        label="°"
                        value={s.deg}
                        onChange={(v) => {
                          if (v !== 0) update(i, { ...s, deg: v });
                        }}
                      />
                      <NumberInput
                        label="r"
                        value={s.radiusMm}
                        min={1}
                        onChange={(v) => {
                          if (v > 0) update(i, { ...s, radiusMm: v });
                        }}
                      />
                    </>
                  ) : (
                    <NumberInput
                      label="mm"
                      value={s.mm}
                      min={1}
                      onChange={(v) => {
                        if (v > 0) update(i, { ...s, mm: v });
                      }}
                    />
                  )}
                  <button
                    type="button"
                    aria-label={`Remove step ${i + 1}`}
                    onClick={() => {
                      setSteps(steps.filter((_, j) => j !== i));
                    }}
                    className="ml-auto px-1 text-muted hover:text-red-600"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setSteps([...steps, { kind: "forward", mm: 300 }]);
                }}
                className="rounded-md border border-border px-2 py-1 text-xs hover:border-accent"
              >
                + Forward
              </button>
              <button
                type="button"
                onClick={() => {
                  setSteps([...steps, { kind: "turn", deg: 90, radiusMm: 200 }]);
                }}
                className="rounded-md border border-border px-2 py-1 text-xs hover:border-accent"
              >
                + Turn left
              </button>
              <button
                type="button"
                onClick={() => {
                  setSteps([...steps, { kind: "turn", deg: -90, radiusMm: 200 }]);
                }}
                className="rounded-md border border-border px-2 py-1 text-xs hover:border-accent"
              >
                + Turn right
              </button>
              <button
                type="button"
                onClick={() => {
                  setSteps([...steps, { kind: "gap", mm: 40 }]);
                }}
                className="rounded-md border border-border px-2 py-1 text-xs hover:border-accent"
              >
                + Gap
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">
            This track came from a file or photo, so its shape is fixed here. You can rename it and
            change the line width.
          </p>
        )}

        <div aria-live="polite">
          {problems.length === 0 ? (
            <p className="text-sm text-accent" data-testid="track-valid">
              Track is valid.
            </p>
          ) : (
            <ul className="space-y-1 text-sm text-red-600" data-testid="track-problems">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={problems.length > 0}
            onClick={() => {
              void saveTrack(track, steps ?? undefined).then(() => {
                setStatus("Saved in this browser.");
                router.replace(`/tracks/edit?id=${track.id}`);
              });
            }}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:text-black"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              download(
                `${slug(track.name)}.track.json`,
                `${JSON.stringify(track, null, 2)}\n`,
                "application/json",
              );
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent"
          >
            Download JSON
          </button>
        </div>
        {status && (
          <p role="status" className="text-sm text-muted">
            {status}
          </p>
        )}
      </section>

      <section aria-label="Preview" className="min-w-0">
        <div className="overflow-hidden rounded-lg border border-border">
          <TrackSvg track={track} grid className="h-[60vh] w-full" />
        </div>
        <p className="mt-2 text-sm text-muted" data-testid="track-stats">
          {stats.lengthM.toFixed(2)} m · {stats.sizeMm.x.toFixed(0)} × {stats.sizeMm.y.toFixed(0)}{" "}
          mm
          {stats.minRadiusMm !== undefined
            ? ` · tightest curve ${stats.minRadiusMm.toFixed(0)} mm`
            : ""}{" "}
          · {stats.closed ? "closed loop" : "open course"} · grid 100 mm
        </p>
      </section>
    </main>
  );
}
