/**
 * Text embeddings for the fix knowledge base (384 dimensions, unit length).
 * - `HttpEmbedder`: bge-small-en-v1.5 served by apps/vision (/embed). Matches meaning, so a
 *   paraphrase with no words in common still finds the right case.
 * - `HashingEmbedder`: dependency-free fallback (tests, no vision service): signed feature hashing
 *   of words, identifier parts and word pairs, so similarity ≈ weighted word overlap.
 * Each stored vector records its model; stores re-embed when the model changes.
 */
export interface Embedder {
  readonly model: string;
  readonly dim: number;
  /** "query": a search; "passage": a stored case (bge embeds them slightly differently). */
  embed(text: string, kind?: "query" | "passage"): Promise<number[]>;
}

/** FNV-1a 32-bit. */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const STOP = new Set(
  "the a an and or of to in on for with is are was be it this that at by from as not no but its into than then when".split(
    " ",
  ),
);

/** Lower-case words, with identifiers also split (lastError → last, error; PWM_A → pwm, a). */
export function tokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?/g) ?? []) {
    const w = raw.toLowerCase();
    if (!STOP.has(w)) out.push(w);
    const parts = raw.split(/_|(?<=[a-z])(?=[A-Z])/);
    if (parts.length > 1) for (const p of parts) if (p.length > 1) out.push(p.toLowerCase());
  }
  return out;
}

export class HashingEmbedder implements Embedder {
  readonly model = "hashing-384-v1";
  readonly dim = 384;

  embed(text: string): Promise<number[]> {
    return Promise.resolve(this.embedSync(text));
  }

  embedSync(text: string): number[] {
    const v = new Array<number>(this.dim).fill(0);
    const t = tokens(text);
    const add = (f: string, w: number) => {
      const h = fnv(f);
      v[h % this.dim] = (v[h % this.dim] ?? 0) + ((h >>> 31) & 1 ? -w : w);
    };
    for (const w of t) add(w, 1);
    for (let i = 0; i + 1 < t.length; i++) add(`${t[i] ?? ""} ${t[i + 1] ?? ""}`, 0.7);
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  }
}

export const cosine = (a: readonly number[], b: readonly number[]) =>
  a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);

/** bge-small-en-v1.5 from the vision service (POST {url}/embed). */
export class HttpEmbedder implements Embedder {
  readonly model = "bge-small-en-v1.5";
  readonly dim = 384;
  constructor(
    private readonly url: string,
    private readonly timeoutMs = 15_000,
  ) {}

  async embed(text: string, kind: "query" | "passage" = "passage"): Promise<number[]> {
    const res = await fetch(`${this.url.replace(/\/$/, "")}/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ texts: [text], kind }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`embedding service: HTTP ${String(res.status)}`);
    const body = (await res.json()) as { dim?: number; vectors?: number[][] };
    const v = body.vectors?.[0];
    if (body.dim !== this.dim || v?.length !== this.dim)
      throw new Error("embedding service: unexpected vector size");
    return v;
  }
}
