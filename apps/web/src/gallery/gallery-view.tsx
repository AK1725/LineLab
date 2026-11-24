"use client";

import { getChassis, getComponent } from "@linelab/component-db";
import { resolveChassis } from "@linelab/design-core";
import { GalleryDetail } from "@linelab/schema";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BomTable } from "../editor/bom";
import { OutlineSvg } from "../editor/outline-svg";
import { newDesignId, saveDesign } from "../editor/persistence";

export default function GalleryView({ id }: { id: string }) {
  const router = useRouter();
  const [item, setItem] = useState<GalleryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    fetch(`/api/gallery/${encodeURIComponent(id)}`)
      .then(async (r) => {
        const j: unknown = await r.json();
        if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${String(r.status)}`);
        setItem(GalleryDetail.parse(j));
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      });
  }, [id]);
  if (error)
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <p>{error}</p>
        <Link href="/gallery" className="text-accent underline">
          Back to the gallery
        </Link>
      </main>
    );
  if (!item) return <p className="p-6 text-sm text-muted">Loading…</p>;
  const chassis = resolveChassis(item.design, getChassis);
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">{item.title}</h1>
      <p className="mt-1 text-sm text-muted">
        by {item.author} · version {item.version} · {item.forks} fork{item.forks === 1 ? "" : "s"}
        {item.forkedFrom && (
          <>
            {" "}
            · forked from{" "}
            <Link href={`/gallery/${item.forkedFrom}`} className="underline">
              another robot
            </Link>
          </>
        )}
      </p>
      {item.description && <p className="mt-4 whitespace-pre-line">{item.description}</p>}
      <div className="mt-6 flex flex-wrap gap-2">
        <button
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white dark:text-black"
          onClick={() => {
            const d = { ...item.design, id: newDesignId(), name: `${item.title} (fork)` };
            void fetch(`/api/gallery/${item.id}/fork`, { method: "POST" }).catch(() => undefined);
            void saveDesign(d).then(() => {
              try {
                sessionStorage.setItem(`forkedFrom:${d.id}`, item.id);
              } catch {
                // without storage the fork just isn't linked to its parent when published
              }
              router.push(`/build/edit?id=${d.id}`);
            });
          }}
        >
          Fork this robot
        </button>
        <button
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent"
          onClick={() => {
            void navigator.clipboard.writeText(window.location.href).then(() => {
              setCopied(true);
            });
          }}
        >
          {copied ? "Link copied" : "Copy link"}
        </button>
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-[18rem_1fr]">
        {chassis && (
          <OutlineSvg chassis={chassis} className="h-64 w-full" title={`${item.title} chassis`} />
        )}
        <BomTable design={item.design} lookup={getComponent} />
      </div>
    </main>
  );
}
