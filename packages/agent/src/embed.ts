/**
 * Text embeddings for the fix knowledge base. `HashingEmbedder` is a dependency-free stand-in:
 * signed feature hashing of words, identifier parts and word pairs into 384 dimensions, L2
 * normalised, so cosine similarity ≈ weighted word overlap. It is deterministic and needs no model
 * download. A neural embedder (BLUEPRINT §5.9: bge-small) can replace it behind the same
 * interface; stored vectors must then be re-embedded (the `model` id is stored with each row).
 */
export interface Embedder {
  readonly model: string;
  readonly dim: number;
  embed(text: string): number[];
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

  embed(text: string): number[] {
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
