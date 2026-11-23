"use client";

import { CATEGORY_INFO, COMPONENTS, categoryLabel, createSearchIndex } from "@linelab/component-db";
import type { Category } from "@linelab/schema";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { summary } from "../lib/specs";

const index = createSearchIndex(COMPONENTS);
const VALID = new Set<string>(CATEGORY_INFO.map((c) => c.id));
const counts = new Map<Category, number>();
for (const c of COMPONENTS) counts.set(c.category, (counts.get(c.category) ?? 0) + 1);

export default function ComponentBrowser() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const [cats, setCats] = useState<Category[]>(() =>
    (params.get("cat") ?? "").split(",").filter((c): c is Category => VALID.has(c)),
  );

  const hits = useMemo(() => index.search(query, { categories: cats }), [query, cats]);

  function sync(nextQuery: string, nextCats: Category[]) {
    const sp = new URLSearchParams();
    if (nextQuery.trim() !== "") sp.set("q", nextQuery.trim());
    if (nextCats.length > 0) sp.set("cat", nextCats.join(","));
    const qs = sp.toString();
    router.replace(qs === "" ? pathname : `${pathname}?${qs}`, { scroll: false });
  }

  function toggle(cat: Category) {
    const next = cats.includes(cat) ? cats.filter((c) => c !== cat) : [...cats, cat];
    setCats(next);
    sync(query, next);
  }

  return (
    <div>
      <label htmlFor="component-search" className="text-sm font-medium">
        Search components
      </label>
      <input
        id="component-search"
        type="search"
        value={query}
        autoFocus
        autoComplete="off"
        spellCheck={false}
        placeholder="Try “tb6612”, “qtr8”, “n20 1000” or “esp32 s3”"
        onChange={(e) => {
          setQuery(e.target.value);
          sync(e.target.value, cats);
        }}
        className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
      />

      <div role="group" aria-label="Filter by category" className="mt-3 flex flex-wrap gap-2">
        {CATEGORY_INFO.map((c) => {
          const on = cats.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              onClick={() => {
                toggle(c.id);
              }}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                on
                  ? "border-accent bg-accent text-white dark:text-black"
                  : "border-border bg-card text-fg hover:border-accent"
              }`}
            >
              {c.plural}{" "}
              <span className={on ? "opacity-80" : "text-muted"}>{counts.get(c.id) ?? 0}</span>
            </button>
          );
        })}
      </div>

      <p className="mt-4 text-sm text-muted" aria-live="polite" data-testid="result-count">
        {hits.length} {hits.length === 1 ? "component" : "components"}
        {hits[0]?.match === "fuzzy" ? " (no exact match: showing close spellings)" : ""}
      </p>

      <ul className="mt-2 grid gap-2 sm:grid-cols-2" data-testid="results">
        {hits.map(({ component: c }) => (
          <li key={c.id}>
            <Link
              href={`/components/${c.id}`}
              className="block h-full rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-accent"
            >
              <span className="block font-medium">{c.name}</span>
              <span className="mt-0.5 block text-sm text-muted">
                {categoryLabel(c.category)} · {summary(c)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {hits.length === 0 && (
        <p className="mt-6 text-sm text-muted">
          Nothing matches “{query}”. Missing a part? Components are plain JSON files: see
          CONTRIBUTING.md.
        </p>
      )}
    </div>
  );
}
