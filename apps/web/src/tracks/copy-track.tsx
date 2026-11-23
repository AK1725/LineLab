"use client";

import type { Track } from "@linelab/schema";
import { useRouter } from "next/navigation";
import { download, slug } from "../editor/files";
import { newTrackId, saveTrack } from "./storage";

export default function CopyTrack({ track }: { track: Track }) {
  const router = useRouter();
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => {
          const copy = { ...track, id: newTrackId(), name: `${track.name} (copy)` };
          void saveTrack(copy).then(() => {
            router.push(`/tracks/edit?id=${copy.id}`);
          });
        }}
        className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent"
      >
        Copy to my tracks
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
  );
}
