"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { deleteTrack, listTracks, type SavedTrack } from "./storage";
import { TrackSvg } from "./track-svg";

export default function SavedTracks() {
  const [saved, setSaved] = useState<SavedTrack[] | null>(null);
  useEffect(() => {
    listTracks().then(setSaved, () => {
      setSaved([]);
    });
  }, []);
  if (!saved || saved.length === 0) return null;
  return (
    <section aria-labelledby="your-tracks" className="mt-8">
      <h2 id="your-tracks" className="text-xl font-semibold">
        Your tracks
      </h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="saved-tracks">
        {saved.map(({ track }) => (
          <li key={track.id} className="rounded-lg border border-border bg-card p-3">
            <Link href={`/tracks/edit?id=${track.id}`} className="block hover:text-accent">
              <TrackSvg track={track} className="h-32 w-full rounded" />
              <span className="mt-2 block font-medium">{track.name}</span>
            </Link>
            <button
              type="button"
              aria-label={`Delete ${track.name}`}
              onClick={() => {
                if (!confirm(`Delete “${track.name}”?`)) return;
                void deleteTrack(track.id).then(() => {
                  setSaved((s) => (s ?? []).filter((x) => x.track.id !== track.id));
                });
              }}
              className="mt-1 text-xs text-muted hover:text-red-600"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
