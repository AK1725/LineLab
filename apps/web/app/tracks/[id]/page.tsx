import { TRACKS, getTrack } from "@linelab/component-db";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CopyTrack from "../../../src/tracks/copy-track";
import { TrackSvg, trackStats } from "../../../src/tracks/track-svg";

export const dynamicParams = false;
export function generateStaticParams() {
  return TRACKS.map((t) => ({ id: t.id }));
}

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = getTrack((await params).id);
  return t ? { title: t.name, description: t.description } : {};
}

export default async function TrackPage({ params }: Props) {
  const t = getTrack((await params).id);
  if (!t) notFound();
  const s = trackStats(t);
  const rows: [string, string][] = [
    ["Length", `${s.lengthM.toFixed(2)} m`],
    ["Size", `${(s.sizeMm.x / 1000).toFixed(2)} × ${(s.sizeMm.y / 1000).toFixed(2)} m`],
    ["Line width", `${t.lineWidthMm} mm`],
    [
      "Tightest curve",
      s.minRadiusMm !== undefined ? `${s.minRadiusMm.toFixed(0)} mm radius` : "none",
    ],
    ["Layout", s.closed ? "closed loop" : "open course (start → finish)"],
    [
      "Features",
      [
        s.gaps && `${s.gaps} gaps`,
        s.inversions && `${s.inversions} inverted`,
        s.crossings && `${s.crossings} crossing`,
        s.junctions && `${s.junctions} junctions`,
      ]
        .filter(Boolean)
        .join(", ") || "none",
    ],
    ["Difficulty", t.difficulty ?? "—"],
  ];
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <p className="text-sm">
        <Link href="/tracks" className="text-muted hover:text-fg">
          ← All tracks
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">{t.name}</h1>
      {t.description && <p className="mt-1 text-muted">{t.description}</p>}
      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        <TrackSvg track={t} grid className="h-[55vh] w-full" />
      </div>
      <p className="mt-1 text-xs text-muted">
        Grid 100 mm · green arrow = start · red square = finish
      </p>
      <dl className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2" data-testid="track-details">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-border py-1">
            <dt className="text-muted">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4">
        <CopyTrack track={t} />
      </div>
    </main>
  );
}
