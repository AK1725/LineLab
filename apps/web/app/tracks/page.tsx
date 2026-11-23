import { TRACKS } from "@linelab/component-db";
import type { Metadata } from "next";
import Link from "next/link";
import SavedTracks from "../../src/tracks/saved-tracks";
import { TrackSvg, trackStats } from "../../src/tracks/track-svg";

export const metadata: Metadata = {
  title: "Tracks",
  description: "Built-in line-following tracks, a track editor, and photo import.",
};

export default function TracksPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tracks</h1>
          <p className="mt-2 text-muted">
            {TRACKS.length} built-in tracks, plus your own: draw one step by step or import a photo.
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Link
            href="/tracks/edit"
            className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white dark:text-black"
          >
            New track
          </Link>
          <Link
            href="/tracks/import"
            className="rounded-lg border border-border px-3 py-2 text-sm hover:border-accent"
          >
            Import from photo
          </Link>
        </div>
      </div>
      <SavedTracks />
      <h2 className="mt-8 text-xl font-semibold">Built-in</h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="builtin-tracks">
        {TRACKS.map((t) => {
          const s = trackStats(t);
          return (
            <li key={t.id}>
              <Link
                href={`/tracks/${t.id}`}
                className="block h-full rounded-lg border border-border bg-card p-3 hover:border-accent"
              >
                <TrackSvg track={t} className="h-36 w-full rounded" />
                <span className="mt-2 block font-medium">{t.name}</span>
                <span className="text-sm text-muted">
                  {t.difficulty ?? "—"} · {s.lengthM.toFixed(1)} m
                  {s.minRadiusMm !== undefined
                    ? ` · min radius ${s.minRadiusMm.toFixed(0)} mm`
                    : ""}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
