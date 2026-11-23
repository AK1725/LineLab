"use client";

import { CATEGORY_INFO, COMPONENTS, createSearchIndex } from "@linelab/component-db";
import type { Category } from "@linelab/schema";
import { useMemo, useState } from "react";
import { summary } from "../lib/specs";
import { useEditor } from "./store";

const index = createSearchIndex(COMPONENTS);

export default function PartsPanel() {
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<Category | "">("");
  const add = useEditor((s) => s.addComponent);
  const hits = useMemo(
    () => index.search(query, { categories: cat ? [cat] : [], limit: 60 }),
    [query, cat],
  );

  return (
    <section aria-labelledby="parts-heading" className="flex h-full min-h-0 flex-col">
      <h2 id="parts-heading" className="px-3 pt-3 text-sm font-semibold">
        Add parts
      </h2>
      <div className="flex gap-2 px-3 py-2">
        <input
          type="search"
          aria-label="Search parts to add"
          placeholder="tb6612, qtr8, n20…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
        />
        <select
          aria-label="Part category"
          value={cat}
          onChange={(e) => {
            setCat(e.target.value as Category | "");
          }}
          className="w-24 rounded-md border border-border bg-bg px-1 text-sm"
        >
          <option value="">All</option>
          {CATEGORY_INFO.map((c) => (
            <option key={c.id} value={c.id}>
              {c.plural}
            </option>
          ))}
        </select>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" data-testid="parts-results">
        {hits.map(({ component: c }) => (
          <li key={c.id} className="flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-bg">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm" title={c.name}>
                {c.name}
              </p>
              <p className="truncate text-xs text-muted">{summary(c)}</p>
            </div>
            <button
              type="button"
              aria-label={`Add ${c.name}`}
              onClick={() => {
                add(c.id);
              }}
              className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium hover:border-accent hover:text-accent"
            >
              Add
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
