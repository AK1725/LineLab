import type { Category, Component } from "@linelab/schema";
import Fuse from "fuse.js";
import { categoryLabel, categoryOrder } from "./categories.js";
import { compact, tokens } from "./text.js";

export interface SearchOptions {
  /** Restrict results to these categories. Empty or undefined = all. */
  categories?: readonly Category[];
  limit?: number;
}

export interface SearchHit {
  component: Component;
  score: number;
  /** How the hit was found: an exact/prefix name match, word matches, or fuzzy (typo) matching. */
  match: "exact" | "prefix" | "tokens" | "fuzzy" | "all";
}

interface Entry {
  component: Component;
  /** Compact forms of the name, id (without category prefix) and each alias. */
  keys: string[];
  words: string[];
}

export interface SearchIndex {
  search(query: string, options?: SearchOptions): SearchHit[];
}

const byCatalogOrder = (a: Component, b: Component) =>
  categoryOrder(a.category) - categoryOrder(b.category) || a.name.localeCompare(b.name);

/**
 * Search tuned for part names: model numbers ("tb6612", "qtr8", "l298") must hit exactly,
 * multi-word queries ("n20 1000", "esp32 s3") must match every word, and typos ("tb6621")
 * fall back to fuzzy matching.
 */
export function createSearchIndex(components: readonly Component[]): SearchIndex {
  const entries: Entry[] = components.map((component) => {
    const idTail = component.id.slice(component.id.indexOf(".") + 1);
    const names = [component.name, idTail, ...component.aliases];
    const words = new Set<string>();
    for (const n of [...names, component.manufacturer ?? "", categoryLabel(component.category)]) {
      for (const w of tokens(n)) words.add(w);
    }
    return { component, keys: names.map(compact), words: [...words] };
  });

  const fuse = new Fuse(entries, {
    keys: [
      { name: "component.name", weight: 2 },
      { name: "component.aliases", weight: 3 },
      { name: "component.id", weight: 1 },
      { name: "component.manufacturer", weight: 0.5 },
    ],
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true,
  });

  function scoreEntry(
    e: Entry,
    q: string,
    qTokens: string[],
  ): { score: number; match: SearchHit["match"] } | null {
    if (e.keys.includes(q)) return { score: 1000, match: "exact" };

    let tokenScore = 0;
    for (const t of qTokens) {
      let best = 0;
      for (const w of e.words) {
        if (w === t) best = Math.max(best, 10);
        else if (w.startsWith(t)) best = Math.max(best, 6);
        // Plural/suffix tolerance ("arduinos" → "arduino"), but never for numbers: "1000" ≠ "100".
        else if (w.length >= 3 && /[a-z]/.test(w) && t.startsWith(w)) best = Math.max(best, 3);
      }
      if (best === 0) {
        tokenScore = -1;
        break;
      }
      tokenScore += best;
    }

    const prefix = e.keys.some((k) => k.startsWith(q)) ? 200 : 0;
    if (prefix > 0) return { score: prefix + Math.max(0, tokenScore), match: "prefix" };
    if (tokenScore > 0) return { score: tokenScore, match: "tokens" };
    return null;
  }

  return {
    search(query, options = {}) {
      const allowed =
        options.categories && options.categories.length > 0 ? new Set(options.categories) : null;
      const inScope = (c: Component) => allowed === null || allowed.has(c.category);
      const q = compact(query);
      const qTokens = tokens(query);

      let hits: SearchHit[];
      if (q.length === 0) {
        hits = entries
          .map((e) => e.component)
          .filter(inScope)
          .sort(byCatalogOrder)
          .map((component) => ({ component, score: 0, match: "all" as const }));
      } else {
        hits = [];
        for (const e of entries) {
          if (!inScope(e.component)) continue;
          const s = scoreEntry(e, q, qTokens);
          if (s !== null) hits.push({ component: e.component, ...s });
        }
        if (hits.length === 0) {
          hits = fuse
            .search(query)
            .filter((r) => inScope(r.item.component))
            .map((r) => ({
              component: r.item.component,
              score: 1 - (r.score ?? 1),
              match: "fuzzy" as const,
            }));
        }
        hits.sort((a, b) => b.score - a.score || byCatalogOrder(a.component, b.component));
      }
      return options.limit !== undefined ? hits.slice(0, options.limit) : hits;
    },
  };
}
