import { readFileSync } from "node:fs";
import { MemoryKnowledge, type FixKnowledge, type NewCase } from "@linelab/agent";
import { PgKnowledge } from "./db/pg-knowledge.js";
import { PgStore } from "./db/pg-store.js";
import { MemoryStore, type Store } from "./store.js";

/**
 * The fix knowledge base: Postgres + pgvector when DATABASE_URL is set (falling back to memory,
 * with a warning, if it can't be reached), else in memory. LINELAB_KB_SEED: a JSON array of
 * synthetic cases (examples/knowledge/seed.json) added once, labelled synthetic.
 */
export async function openKnowledge(env: NodeJS.ProcessEnv): Promise<FixKnowledge> {
  let kb: FixKnowledge = new MemoryKnowledge();
  if (env.DATABASE_URL) {
    try {
      kb = await PgKnowledge.connect(env.DATABASE_URL);
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
