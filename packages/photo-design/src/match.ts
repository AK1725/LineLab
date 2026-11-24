import type { Category, Component, PhotoDetection } from "@linelab/schema";
import type { SearchHit, SearchIndex } from "@linelab/component-db";

export interface MatchCandidate {
  componentId: string;
  name: string;
  /** Relative score (higher is better); not a probability. */
  score: number;
  /** Which query found it, for the "why" tooltip. */
  via: string;
}

export interface DetectionMatch {
  detectionId: string;
  candidates: MatchCandidate[];
}

/** Detector categories → database categories to search (a "sensor" may be the line array). */
const SEARCH_CATEGORIES: Partial<Record<Category, Category[]>> = {
  sensor: ["sensor", "line_sensor"],
  line_sensor: ["line_sensor", "sensor"],
  regulator: ["regulator", "misc"],
  misc: ["misc", "regulator", "mechanical"],
};

const MATCH_WEIGHT: Record<SearchHit["match"], number> = {
  exact: 1,
  prefix: 0.85,
  tokens: 0.7,
  fuzzy: 0.35,
  all: 0.05,
};

const STOP = new Set([
  "a",
  "an",
  "the",
  "with",
  "and",
  "of",
  "on",
  "in",
  "for",
  "two",
  "small",
  "tiny",
  "board",
]);

/** Words in a description that look like part numbers or sizes: "TB6612FNG", "N20", "QTR-8A", "65mm", "18650". */
export function modelTokens(text: string): string[] {
  const words = text.split(/[\s,;()/]+/).map((w) => w.replace(/^[^\w]+|[^\w]+$/g, ""));
  const out = words.filter(
    (w) =>
      w.length >= 2 && (/\d/.test(w) || /^[A-Z][A-Z0-9-]{2,}$/.test(w)) && !/^\d+(\.\d+)?$/.test(w),
  );
  return [...new Set(out)].slice(0, 8);
}

/**
 * Top-3 database parts for each detection (BLUEPRINT §5.10 step 3). Read markings count most,
 * then part-number-like words from the description, then the description's words together. If
 * nothing matches, the category's most common parts are offered (low score) so the user can still
 * pick one.
 */
export function matchDetection(
  d: PhotoDetection,
  index: SearchIndex,
  all: readonly Component[],
  k = 3,
): DetectionMatch {
  const categories = SEARCH_CATEGORIES[d.category] ?? [d.category];
  const scores = new Map<string, MatchCandidate>();
  const add = (query: string, weight: number) => {
    if (!query.trim()) return;
    index.search(query, { categories, limit: 6 }).forEach((h, rank) => {
      const s = weight * MATCH_WEIGHT[h.match] * (1 / (1 + rank * 0.5));
      const prev = scores.get(h.component.id);
      scores.set(h.component.id, {
        componentId: h.component.id,
        name: h.component.name,
        score: (prev?.score ?? 0) + s,
        via: prev?.via ?? query,
      });
    });
  };
  for (const m of d.markings) add(m, 3);
  const tokens = modelTokens(d.description);
  for (const t of tokens) add(t, 2);
  // Pairs like "N20 1000" or "65mm wheel" pin down a variant.
  for (let i = 0; i + 1 < tokens.length; i++) add(`${tokens[i] ?? ""} ${tokens[i + 1] ?? ""}`, 1.5);
  // Plain word pairs ("8 channel", "yellow TT") catch sizes and variants with no part number.
  const words = d.description
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((w) => w.length > 0 && !STOP.has(w));
  for (let i = 0; i + 1 < words.length; i++)
    add(`${words[i] ?? ""} ${words[i + 1] ?? ""}`, scores.size === 0 ? 0.5 : 0.4);
  let candidates = [...scores.values()].sort((a, b) => b.score - a.score);
  if (candidates.length < k) {
    const extra = all
      .filter((c) => categories.includes(c.category) && !scores.has(c.id))
      .slice(0, k - candidates.length)
      .map((c) => ({ componentId: c.id, name: c.name, score: 0, via: `any ${d.category}` }));
    candidates = [...candidates, ...extra];
  }
  return {
    detectionId: d.id,
    candidates: candidates
      .slice(0, k)
      .map((c) => ({ ...c, score: Math.round(c.score * 100) / 100 })),
  };
}

export const matchDetections = (
  ds: readonly PhotoDetection[],
  index: SearchIndex,
  all: readonly Component[],
  k = 3,
): DetectionMatch[] => ds.map((d) => matchDetection(d, index, all, k));
