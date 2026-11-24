import { readFileSync } from "node:fs";
import {
  HashingEmbedder,
  HttpEmbedder,
  MemoryKnowledge,
  type Embedder,
  type FixKnowledge,
  type NewCase,
} from "@linelab/agent";
import { PgKnowledge } from "./db/pg-knowledge.js";
import { PgStore } from "./db/pg-store.js";
import { MemoryStore, type Store } from "./store.js";

/**
 * Embeddings: bge-small from the vision service when EMBEDDINGS_URL is set and answers, else the
 * word-hashing fallback (with a warning). Stored cases are re-embedded when this changes.
 */
export async function openEmbedder(env: NodeJS.ProcessEnv): Promise<Embedder> {
  if (env.EMBEDDINGS_URL) {
    const http = new HttpEmbedder(env.EMBEDDINGS_URL, 60_000);
    // The first call loads the model; retry while the vision service starts.
    for (let i = 0; i < 10; i++) {
      try {
        await http.embed("ping", "query");
        return http;
      } catch (err) {
        if (i === 9)
          console.warn(
            `Knowledge base: embedding service unavailable (${(err as Error).message}); matching words instead of meaning.`,
          );
        else await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
  return new HashingEmbedder();
}

/**
 * The fix knowledge base: Postgres + pgvector when DATABASE_URL is set (falling back to memory,
 * with a warning, if it can't be reached), else in memory. LINELAB_KB_SEED: a JSON array of
 * synthetic cases (examples/knowledge/seed.json) added once, labelled synthetic.
 */
export async function openKnowledge(env: NodeJS.ProcessEnv): Promise<FixKnowledge> {
  const embedder = await openEmbedder(env);
  let kb: FixKnowledge = new MemoryKnowledge(embedder);
  if (env.DATABASE_URL) {
    try {
      kb = await PgKnowledge.connect(env.DATABASE_URL, embedder);
    } catch (err) {
      console.warn(
        `Knowledge base: can't reach Postgres (${(err as Error).message}); using memory, fixes won't persist.`,
      );
    }
  }
  if (env.LINELAB_KB_SEED) {
    const seed = JSON.parse(readFileSync(env.LINELAB_KB_SEED, "utf8")) as NewCase[];
    const empty = kb instanceof PgKnowledge ? (await kb.count()) === 0 : true;
    if (empty) for (const c of seed) await kb.add({ ...c, source: "synthetic" });
  }
  return kb;
}

/** Accounts and the gallery: Postgres when DATABASE_URL is set, else memory (lost on restart). */
export async function openStore(env: NodeJS.ProcessEnv): Promise<Store> {
  if (env.DATABASE_URL) {
    try {
      return await PgStore.connect(env.DATABASE_URL);
    } catch (err) {
      console.warn(
        `Gallery: can't reach Postgres (${(err as Error).message}); using memory, nothing will persist.`,
      );
    }
  }
  return new MemoryStore();
}
