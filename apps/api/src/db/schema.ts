import { index, integer, pgTable, text, timestamp, uuid, vector } from "drizzle-orm/pg-core";

/** Shared bug → fix cases (BLUEPRINT §5.9.2). No sketches, no user identity: see ADR 0012. */
export const fixCases = pgTable(
  "fix_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symptoms: text("symptoms").notNull(),
    diagnosis: text("diagnosis").notNull(),
    diff: text("diff").notNull(),
    /** sha256 of the diff: one row per fix, confirmations counted on it. */
    diffHash: text("diff_hash").notNull().unique(),
    confirmations: integer("confirmations").notNull().default(0),
    source: text("source", { enum: ["user", "synthetic"] }).notNull(),
    parts: text("parts").array().notNull().default([]),
    embeddingModel: text("embedding_model").notNull(),
    embedding: vector("embedding", { dimensions: 384 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("fix_cases_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops"))],
);

/** Idempotent DDL, run at startup (the schema is small; no migration tool needed yet). */
export const MIGRATIONS = [
  "CREATE EXTENSION IF NOT EXISTS vector",
  `CREATE TABLE IF NOT EXISTS fix_cases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    symptoms text NOT NULL,
    diagnosis text NOT NULL,
    diff text NOT NULL,
    diff_hash text NOT NULL UNIQUE,
    confirmations integer NOT NULL DEFAULT 0,
    source text NOT NULL CHECK (source IN ('user', 'synthetic')),
    parts text[] NOT NULL DEFAULT '{}',
    embedding_model text NOT NULL,
    embedding vector(384) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  "CREATE INDEX IF NOT EXISTS fix_cases_embedding_idx ON fix_cases USING hnsw (embedding vector_cosine_ops)",
];
