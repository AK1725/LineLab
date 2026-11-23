import type { Metadata } from "next";
import { Suspense } from "react";
import TrackEditor from "../../../src/tracks/track-editor";

export const metadata: Metadata = { title: "Track editor" };

export default function TrackEditPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted">Loading…</p>}>
      <TrackEditor />
    </Suspense>
  );
}
