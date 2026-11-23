"use client";

import { CHASSIS, getChassis } from "@linelab/component-db";
import { newDesign } from "@linelab/design-core";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { parseDesignFile } from "./files";
import { OutlineSvg } from "./outline-svg";
import {
  deleteDesign,
  listDesigns,
  newDesignId,
  saveDesign,
  type SavedDesign,
} from "./persistence";

export default function BuildHome() {
  const router = useRouter();
  const [saved, setSaved] = useState<SavedDesign[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    listDesigns().then(setSaved, () => {
      setSaved([]);
      setError("Browser storage is unavailable, so designs can't be saved here (private window?).");
    });
  }, []);

  async function create(chassisId: string, name: string) {
    const d = newDesign(newDesignId(), name, { kind: "template", chassisId });
    await saveDesign(d);
    router.push(`/build/edit?id=${d.id}`);
  }

  async function importFile(file: File) {
    const r = parseDesignFile(await file.text());
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const d = { ...r.design, id: newDesignId() };
    await saveDesign(d);
    router.push(`/build/edit?id=${d.id}`);
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">Build a robot</h1>
      <p className="mt-2 text-muted">
        Pick a chassis to start from. You can switch chassis or draw your own at any time.
      </p>

      <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Chassis templates">
        {CHASSIS.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => {
                void create(c.id, c.name.replace(/\s*\(.*\)$/, ""));
              }}
              className="flex h-full w-full flex-col rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-accent"
            >
              <OutlineSvg chassis={c} className="h-32 w-full" title={`${c.name} outline`} />
              <span className="mt-2 font-medium">{c.name}</span>
              <span className="text-sm text-muted">{c.inspiredBy}</span>
            </button>
          </li>
        ))}
      </ul>

      <section aria-labelledby="saved-heading" className="mt-10">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="saved-heading" className="text-xl font-semibold">
            Your designs
          </h2>
          <label className="ml-auto cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent">
            Import design JSON
            <input
              type="file"
              accept=".json,application/json"
              aria-label="Import design JSON"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importFile(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}
        {saved === null ? (
          <p className="mt-3 text-sm text-muted">Loading…</p>
        ) : saved.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            No designs yet. They are saved in this browser as you work.
          </p>
        ) : (
          <ul
            className="mt-3 divide-y divide-border rounded-lg border border-border bg-card"
            data-testid="saved-designs"
          >
            {saved.map(({ design: d, updatedAt }) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                <a href={`/build/edit?id=${d.id}`} className="min-w-0 flex-1 hover:text-accent">
                  <span className="block truncate font-medium">{d.name}</span>
                  <span className="text-sm text-muted">
                    {d.chassis.kind === "custom"
                      ? "Custom chassis"
                      : (getChassis(d.chassis.chassisId)?.name ?? d.chassis.chassisId)}{" "}
                    · {d.placements.length} parts · {new Date(updatedAt).toLocaleString()}
                  </span>
                </a>
                <button
                  type="button"
                  aria-label={`Delete ${d.name}`}
                  onClick={() => {
                    if (!confirm(`Delete “${d.name}”? This cannot be undone.`)) return;
                    void deleteDesign(d.id).then(() => {
                      setSaved((s) => (s ?? []).filter((x) => x.design.id !== d.id));
                    });
                  }}
                  className="rounded-md px-2 py-1 text-sm text-muted hover:text-red-600"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
