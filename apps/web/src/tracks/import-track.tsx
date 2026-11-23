"use client";

import { Track } from "@linelab/schema";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { newTrackId, saveTrack } from "./storage";
import { TrackSvg } from "./track-svg";

interface Diagnostics {
  line_width_mm: number;
  length_mm: number;
  paths: number;
  confidence: number;
  warnings: string[];
}

const CORNER_NAMES = ["top-left", "top-right", "bottom-right", "bottom-left"];

export default function ImportTrack() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [mode, setMode] = useState<"corners" | "scale">("corners");
  const [corners, setCorners] = useState<[number, number][]>([]);
  const [size, setSize] = useState({ width: 1000, height: 700 });
  const [mmPerPx, setMmPerPx] = useState(1);
  const [name, setName] = useState("Imported track");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ track: Track; diagnostics: Diagnostics } | null>(null);
  const img = useRef<HTMLImageElement>(null);

  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  async function run() {
    if (!file) return;
    setBusy(true);
    setError("");
    setResult(null);
    const form = new FormData();
    form.append("file", file);
    form.append("name", name);
    form.append("track_id", newTrackId());
    if (mode === "corners") {
      form.append("corners", JSON.stringify(corners));
      form.append("width_mm", String(size.width));
      form.append("height_mm", String(size.height));
    } else form.append("mm_per_px", String(mmPerPx));
    try {
      const res = await fetch("/api/vision/track-from-image", { method: "POST", body: form });
      const body = (await res.json()) as {
        detail?: string;
        track?: unknown;
        diagnostics?: Diagnostics;
      };
      if (!res.ok) throw new Error(body.detail ?? `The vision service returned ${res.status}.`);
      const parsed = Track.safeParse(body.track);
      if (!parsed.success || !body.diagnostics)
        throw new Error("The vision service returned an invalid track.");
      setResult({ track: parsed.data, diagnostics: body.diagnostics });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ready =
    file &&
    (mode === "scale" ? mmPerPx > 0 : corners.length === 4 && size.width > 0 && size.height > 0);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <p className="text-sm">
        <Link href="/tracks" className="text-muted hover:text-fg">
          ← Tracks
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-bold">Import a track from a photo</h1>
      <p className="mt-1 text-sm text-muted">
        Photograph the track from above (or scan a printout). Mark the four corners of something
        rectangular whose size you know, such as the track mat or a sheet of paper, so LineLab can
        undo the perspective and get the scale right.
      </p>

      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0">
          <label className="block text-sm">
            <span className="text-muted">Image (PNG or JPEG)</span>
            <input
              type="file"
              accept="image/png,image/jpeg"
              aria-label="Track image"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setCorners([]);
                setResult(null);
              }}
              className="mt-1 block text-sm"
            />
          </label>
          {url && (
            <div className="relative mt-3 inline-block max-w-full">
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
              <img
                ref={img}
                src={url}
                alt="Uploaded track"
                onLoad={(e) => {
                  setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
                }}
                onClick={(e) => {
                  if (mode !== "corners" || corners.length >= 4 || !natural) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  const x = ((e.clientX - r.left) / r.width) * natural.w;
                  const y = ((e.clientY - r.top) / r.height) * natural.h;
                  setCorners([...corners, [Math.round(x), Math.round(y)]]);
                }}
                className={`max-h-[60vh] max-w-full rounded border border-border ${mode === "corners" && corners.length < 4 ? "cursor-crosshair" : ""}`}
              />
              {natural &&
                corners.map(([x, y], i) => (
                  <span
                    key={i}
                    className="pointer-events-none absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white"
                    style={{ left: `${(x / natural.w) * 100}%`, top: `${(y / natural.h) * 100}%` }}
                  >
                    {i + 1}
                  </span>
                ))}
            </div>
          )}
        </div>

        <aside className="space-y-3 text-sm">
          <fieldset className="space-y-2">
            <legend className="font-medium">Scale</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={mode === "corners"}
                onChange={() => {
                  setMode("corners");
                }}
              />{" "}
              Mark 4 corners (photo)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={mode === "scale"}
                onChange={() => {
                  setMode("scale");
                }}
              />{" "}
              Known scale (top-down scan)
            </label>
          </fieldset>
          {mode === "corners" ? (
            <div className="space-y-2">
              <p className="text-muted" role="status">
                {corners.length < 4
                  ? `Click the ${CORNER_NAMES[corners.length]} corner.`
                  : "All four corners marked."}
              </p>
              <button
                type="button"
                onClick={() => {
                  setCorners([]);
                }}
                className="text-xs text-accent hover:underline"
              >
                Reset corners
              </button>
              <label className="flex items-center justify-between">
                <span className="text-muted">Rectangle width (mm)</span>
                <input
                  type="number"
                  aria-label="Rectangle width in mm"
                  value={size.width}
                  onChange={(e) => {
                    setSize({ ...size, width: Number(e.target.value) });
                  }}
                  className="w-24 rounded border border-border bg-bg px-1 text-right"
                />
              </label>
              <label className="flex items-center justify-between">
                <span className="text-muted">Rectangle height (mm)</span>
                <input
                  type="number"
                  aria-label="Rectangle height in mm"
                  value={size.height}
                  onChange={(e) => {
                    setSize({ ...size, height: Number(e.target.value) });
                  }}
                  className="w-24 rounded border border-border bg-bg px-1 text-right"
                />
              </label>
            </div>
          ) : (
            <label className="flex items-center justify-between">
              <span className="text-muted">mm per pixel</span>
              <input
                type="number"
                step="0.01"
                aria-label="Millimetres per pixel"
                value={mmPerPx}
                onChange={(e) => {
                  setMmPerPx(Number(e.target.value));
                }}
                className="w-24 rounded border border-border bg-bg px-1 text-right"
              />
            </label>
          )}
          <label className="block">
            <span className="text-muted">Name</span>
            <input
              aria-label="Imported track name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              className="mt-1 w-full rounded border border-border bg-bg px-2 py-1"
            />
          </label>
          <button
            type="button"
            disabled={!ready || busy}
            onClick={() => {
              void run();
            }}
            className="w-full rounded-lg bg-accent py-2 font-medium text-white disabled:opacity-40 dark:text-black"
          >
            {busy ? "Finding the line…" : "Find the line"}
          </button>
          {error && (
            <p role="alert" className="text-red-600">
              {error}
            </p>
          )}
        </aside>
      </div>

      {result && (
        <section aria-labelledby="result-heading" className="mt-6">
          <h2 id="result-heading" className="text-lg font-semibold">
            Result
          </h2>
          <p className="text-sm text-muted" data-testid="import-diagnostics">
            {(result.diagnostics.length_mm / 1000).toFixed(2)} m of line ·{" "}
            {result.diagnostics.line_width_mm} mm wide · {result.diagnostics.paths} piece(s) ·
            confidence {Math.round(result.diagnostics.confidence * 100)}%
          </p>
          {result.diagnostics.warnings.map((w) => (
            <p key={w} className="text-sm text-amber-600">
              {w}
            </p>
          ))}
          <div className="mt-2 overflow-hidden rounded-lg border border-border">
            <TrackSvg track={result.track} grid className="h-[50vh] w-full" />
          </div>
          <button
            type="button"
            onClick={() => {
              void saveTrack(result.track).then(() => {
                router.push(`/tracks/edit?id=${result.track.id}`);
              });
            }}
            className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white dark:text-black"
          >
            Save and open in editor
          </button>
        </section>
      )}
    </main>
  );
}
