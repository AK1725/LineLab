import { createHash } from "node:crypto";
import {
  caseText,
  HashingEmbedder,
  rankScore,
  type Embedder,
  type FixKnowledge,
  type KnowledgeCase,
  type NewCase,
} from "@linelab/agent";
import { cosineDistance, eq, ne, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { fixCases, MIGRATIONS } from "./schema.js";

type Row = typeof fixCases.$inferSelect;
const toCase = (r: Row): KnowledgeCase => ({
  id: r.id,
  symptoms: r.symptoms,
  diagnosis: r.diagnosis,
  diff: r.diff,
  confirmations: r.confirmations,
  source: r.source,
  parts: r.parts,
});

/** The fix knowledge base in Postgres + pgvector (cosine HNSW index). */
export class PgKnowledge implements FixKnowledge {
  private constructor(
    private readonly client: postgres.Sql,
    private readonly db: PostgresJsDatabase,
    private readonly embedder: Embedder,
  ) {}

  static async connect(
    url: string,
    embedder: Embedder = new HashingEmbedder(),
  ): Promise<PgKnowledge> {
    const client = postgres(url, { max: 5, onnotice: () => undefined });
    for (const m of MIGRATIONS) await client.unsafe(m);
    const kb = new PgKnowledge(client, drizzle(client), embedder);
    await kb.reembed();
    return kb;
  }

  /** Re-embeds rows stored with another model (after switching embedders). Returns how many. */
  async reembed(): Promise<number> {
    const stale = await this.db
      .select()
      .from(fixCases)
      .where(ne(fixCases.embeddingModel, this.embedder.model));
    for (const r of stale)
      await this.db
        .update(fixCases)
        .set({
          embeddingModel: this.embedder.model,
          embedding: await this.embedder.embed(caseText(r), "passage"),
        })
        .where(eq(fixCases.id, r.id));
    return stale.length;
  }

  async search(query: string, k = 3): Promise<KnowledgeCase[]> {
    const q = await this.embedder.embed(query, "query");
    const distance = cosineDistance(fixCases.embedding, q);
    // Nearest 4k by vector, then re-ranked by similarity weighted by confirmations.
    const rows = await this.db
      .select({ row: fixCases, distance })
      .from(fixCases)
      .where(eq(fixCases.embeddingModel, this.embedder.model))
      .orderBy(distance)
      .limit(4 * k);
    return rows
      .map((r) => ({ c: toCase(r.row), sim: 1 - Number(r.distance) }))
      .filter((x) => x.sim > 0.1)
      .sort((a, b) => rankScore(b.sim, b.c) - rankScore(a.sim, a.c))
      .slice(0, k)
      .map((x) => x.c);
  }

  async add(c: NewCase): Promise<KnowledgeCase> {
    const source = c.source ?? "user";
    const diffHash = createHash("sha256").update(c.diff).digest("hex");
    const [row] = await this.db
      .insert(fixCases)
      .values({
        symptoms: c.symptoms,
        diagnosis: c.diagnosis,
        diff: c.diff,
        diffHash,
        confirmations: source === "user" ? 1 : 0,
        source,
        parts: c.parts ?? [],
        embeddingModel: this.embedder.model,
        embedding: await this.embedder.embed(caseText(c), "passage"),
      })
      .onConflictDoUpdate({
        target: fixCases.diffHash,
        set: {
          // A user confirming a synthetic case makes it a user case.
          confirmations: sql`${fixCases.confirmations} + ${source === "user" ? 1 : 0}`,
          source: sql`CASE WHEN ${source} = 'user' THEN 'user' ELSE ${fixCases.source} END`,
        },
      })
      .returning();
    if (!row) throw new Error("insert returned no row");
    return toCase(row);
  }

  async count(): Promise<number> {
    const [r] = await this.db.select({ n: sql<number>`count(*)::int` }).from(fixCases);
    return r?.n ?? 0;
  }

  close(): Promise<void> {
    return this.client.end();
  }
}
