"use client";

import type { GalleryItem } from "@linelab/schema";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function GalleryList() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/gallery?q=${encodeURIComponent(q)}`, { signal: ac.signal })
        .then(async (r) => {
          const j = (await r.json()) as { items?: GalleryItem[]; error?: string };
          if (!r.ok) throw new Error(j.error ?? `HTTP ${String(r.status)}`);
          setItems(j.items ?? []);
          setError(null);
        })
        .catch((e: unknown) => {
          if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e));
        });
    }, 200);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [q]);
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">Gallery</h1>
      <p className="mt-2 text-muted">
        Robots people built and shared. Open one to see it, then fork it to make your own copy.
      </p>
      <label className="mt-6 block max-w-md text-sm">
        <span className="sr-only">Search the gallery</span>
        <input
          type="search"
          value={q}
          placeholder="Search robots…"
          onChange={(e) => {
            setQ(e.target.value);
          }}
          className="w-full rounded-md border border-border bg-bg px-3 py-2"
        />
      </label>
      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {items && items.length === 0 && !error && (
        <p className="mt-6 text-sm text-muted">
          Nothing here yet. Publish a robot from the editor (Publish button) to start the gallery.
        </p>
      )}
      <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Robots">
        {items?.map((i) => (
          <li key={i.id}>
            <Link
              href={`/gallery/${i.id}`}
              className="block h-full rounded-lg border border-border bg-card p-3 hover:border-accent"
            >
              <span className="font-medium">{i.title}</span>
              <span className="mt-1 block text-sm text-muted">
                by {i.author} · v{i.version} · {i.forks} fork{i.forks === 1 ? "" : "s"}
              </span>
              {i.description && (
                <span className="mt-2 line-clamp-2 block text-sm">{i.description}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
