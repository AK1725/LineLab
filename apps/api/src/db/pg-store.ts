import type { Design, GalleryItem, PublishRequest, SessionUser } from "@linelab/schema";
import { and, desc, eq, gt, ilike, or, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { newId, type Store, type UserRow } from "../store.js";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  provider: text("provider", { enum: ["github", "email"] }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const loginTokens = pgTable("login_tokens", {
  hash: text("hash").primaryKey(),
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const gallery = pgTable("gallery", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  author: text("author").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  visibility: text("visibility", { enum: ["public", "unlisted"] }).notNull(),
  forkedFrom: text("forked_from"),
  forks: integer("forks").notNull().default(0),
  version: integer("version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const galleryVersions = pgTable(
  "gallery_versions",
  {
    itemId: text("item_id").notNull(),
    version: integer("version").notNull(),
    design: jsonb("design").$type<Design>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.version] })],
);

const DDL = [
  `CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, key text NOT NULL UNIQUE, name text NOT NULL,
    provider text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS login_tokens (hash text PRIMARY KEY, email text NOT NULL, expires_at timestamptz NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS gallery (id text PRIMARY KEY, owner_id text NOT NULL REFERENCES users(id),
    author text NOT NULL, title text NOT NULL, description text NOT NULL, visibility text NOT NULL,
    forked_from text, forks integer NOT NULL DEFAULT 0, version integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS gallery_versions (item_id text NOT NULL REFERENCES gallery(id) ON DELETE CASCADE,
    version integer NOT NULL, design jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (item_id, version))`,
  "CREATE INDEX IF NOT EXISTS gallery_public_updated ON gallery (updated_at DESC) WHERE visibility = 'public'",
];

type GalleryRow = typeof gallery.$inferSelect;
const toItem = (r: GalleryRow): GalleryItem => ({
  id: r.id,
  title: r.title,
  description: r.description,
  author: r.author,
  version: r.version,
  ...(r.forkedFrom ? { forkedFrom: r.forkedFrom } : {}),
  forks: r.forks,
  visibility: r.visibility,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});
const toUser = (r: typeof users.$inferSelect): UserRow => ({
  id: r.id,
  key: r.key,
  name: r.name,
  provider: r.provider,
});

export class PgStore implements Store {
  private constructor(
    private readonly client: postgres.Sql,
    private readonly db: PostgresJsDatabase,
  ) {}

  static async connect(url: string): Promise<PgStore> {
    const client = postgres(url, { max: 5, onnotice: () => undefined });
    for (const d of DDL) await client.unsafe(d);
    return new PgStore(client, drizzle(client));
  }

  async upsertUser(key: string, name: string, provider: SessionUser["provider"]) {
    const [r] = await this.db
      .insert(users)
      .values({ id: newId(), key, name, provider })
      .onConflictDoUpdate({ target: users.key, set: { name } })
      .returning();
    if (!r) throw new Error("upsert returned no row");
    return toUser(r);
  }
  async getUser(id: string) {
    const [r] = await this.db.select().from(users).where(eq(users.id, id));
    return r ? toUser(r) : undefined;
  }
  async putLoginToken(hash: string, email: string, expiresAt: Date) {
    await this.db.insert(loginTokens).values({ hash, email, expiresAt });
  }
  async takeLoginToken(hash: string) {
    const [r] = await this.db
      .delete(loginTokens)
      .where(and(eq(loginTokens.hash, hash), gt(loginTokens.expiresAt, new Date())))
      .returning();
    return r?.email;
  }
  async publish(owner: UserRow, req: PublishRequest) {
    const id = newId();
    return this.db.transaction(async (tx) => {
      let forkedFrom: string | null = null;
      if (req.forkedFrom) {
        const [p] = await tx
          .select({ id: gallery.id })
          .from(gallery)
          .where(eq(gallery.id, req.forkedFrom));
        forkedFrom = p?.id ?? null;
      }
      const [r] = await tx
        .insert(gallery)
        .values({
          id,
          ownerId: owner.id,
          author: owner.name,
          title: req.title,
          description: req.description,
          visibility: req.visibility,
          forkedFrom,
          version: 1,
        })
        .returning();
      await tx.insert(galleryVersions).values({ itemId: id, version: 1, design: req.design });
      if (!r) throw new Error("insert returned no row");
      return toItem(r);
    });
  }
  async update(id: string, owner: UserRow, req: PublishRequest) {
    return this.db.transaction(async (tx) => {
      const [cur] = await tx.select().from(gallery).where(eq(gallery.id, id)).for("update");
      if (!cur) return undefined;
      if (cur.ownerId !== owner.id) return "forbidden" as const;
      const version = cur.version + 1;
      await tx.insert(galleryVersions).values({ itemId: id, version, design: req.design });
      const [r] = await tx
        .update(gallery)
        .set({
          title: req.title,
          description: req.description,
          visibility: req.visibility,
          version,
          updatedAt: new Date(),
        })
        .where(eq(gallery.id, id))
        .returning();
      return r ? toItem(r) : undefined;
    });
  }
  async get(id: string) {
    const [r] = await this.db.select().from(gallery).where(eq(gallery.id, id));
    if (!r) return undefined;
    const [v] = await this.db
      .select()
      .from(galleryVersions)
      .where(and(eq(galleryVersions.itemId, id), eq(galleryVersions.version, r.version)));
    return v ? { ...toItem(r), design: v.design } : undefined;
  }
  async list(q: string, limit: number, offset: number) {
    const words = q.split(/\s+/).filter(Boolean).slice(0, 5);
    const conds = words.map((w) => {
      const pat = `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      return or(
        ilike(gallery.title, pat),
        ilike(gallery.description, pat),
        ilike(gallery.author, pat),
      );
    });
    const rows = await this.db
      .select()
      .from(gallery)
      .where(and(eq(gallery.visibility, "public"), ...conds))
      .orderBy(desc(gallery.updatedAt))
      .limit(limit)
      .offset(offset);
    return rows.map(toItem);
  }
  async remove(id: string, owner: UserRow) {
    const [cur] = await this.db
      .select({ ownerId: gallery.ownerId })
      .from(gallery)
      .where(eq(gallery.id, id));
    if (!cur) return false;
    if (cur.ownerId !== owner.id) return "forbidden" as const;
    await this.db.delete(gallery).where(eq(gallery.id, id));
    return true;
  }
  async countFork(id: string) {
    await this.db
      .update(gallery)
      .set({ forks: sql`${gallery.forks} + 1` })
      .where(eq(gallery.id, id));
  }
  close() {
    return this.client.end();
  }
}
