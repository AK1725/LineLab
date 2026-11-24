import { randomBytes } from "node:crypto";
import type {
  Design,
  GalleryDetail,
  GalleryItem,
  PublishRequest,
  SessionUser,
} from "@linelab/schema";

export interface UserRow extends SessionUser {
  /** "github:<id>" or "email:<address>". */
  key: string;
}

/** Persistence for accounts, sign-in links and the gallery. Memory (dev/tests) or Postgres. */
export interface Store {
  upsertUser(key: string, name: string, provider: SessionUser["provider"]): Promise<UserRow>;
  getUser(id: string): Promise<UserRow | undefined>;
  /** One-time sign-in token (stored as a hash); consumed by takeLoginToken. */
  putLoginToken(hash: string, email: string, expiresAt: Date): Promise<void>;
  takeLoginToken(hash: string): Promise<string | undefined>;
  publish(owner: UserRow, req: PublishRequest): Promise<GalleryItem>;
  update(
    id: string,
    owner: UserRow,
    req: PublishRequest,
  ): Promise<GalleryItem | "forbidden" | undefined>;
  get(id: string): Promise<GalleryDetail | undefined>;
  list(q: string, limit: number, offset: number): Promise<GalleryItem[]>;
  remove(id: string, owner: UserRow): Promise<boolean | "forbidden">;
  countFork(id: string): Promise<void>;
}

/** Short, URL-safe, unguessable id (unlisted items rely on it). */
export const newId = () =>
  [...randomBytes(12)].map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

interface Item {
  id: string;
  ownerId: string;
  author: string;
  title: string;
  description: string;
  visibility: "public" | "unlisted";
  forkedFrom?: string;
  forks: number;
  versions: Design[];
  createdAt: Date;
  updatedAt: Date;
}

const toItem = (i: Item): GalleryItem => ({
  id: i.id,
  title: i.title,
  description: i.description,
  author: i.author,
  version: i.versions.length,
  ...(i.forkedFrom ? { forkedFrom: i.forkedFrom } : {}),
  forks: i.forks,
  visibility: i.visibility,
  createdAt: i.createdAt.toISOString(),
  updatedAt: i.updatedAt.toISOString(),
});

export class MemoryStore implements Store {
  private users = new Map<string, UserRow>();
  private tokens = new Map<string, { email: string; expiresAt: Date }>();
  private items = new Map<string, Item>();

  upsertUser(key: string, name: string, provider: SessionUser["provider"]) {
    const existing = [...this.users.values()].find((u) => u.key === key);
    if (existing) {
      existing.name = name;
      return Promise.resolve(existing);
    }
    const u = { id: newId(), key, name, provider };
    this.users.set(u.id, u);
    return Promise.resolve(u);
  }
  getUser(id: string) {
    return Promise.resolve(this.users.get(id));
  }
  putLoginToken(hash: string, email: string, expiresAt: Date) {
    this.tokens.set(hash, { email, expiresAt });
    return Promise.resolve();
  }
  takeLoginToken(hash: string) {
    const t = this.tokens.get(hash);
    this.tokens.delete(hash);
    return Promise.resolve(t && t.expiresAt > new Date() ? t.email : undefined);
  }
  publish(owner: UserRow, req: PublishRequest) {
    const now = new Date();
    const item: Item = {
      id: newId(),
      ownerId: owner.id,
      author: owner.name,
      title: req.title,
      description: req.description,
      visibility: req.visibility,
      ...(req.forkedFrom && this.items.has(req.forkedFrom) ? { forkedFrom: req.forkedFrom } : {}),
      forks: 0,
      versions: [req.design],
      createdAt: now,
      updatedAt: now,
    };
    this.items.set(item.id, item);
    return Promise.resolve(toItem(item));
  }
  update(id: string, owner: UserRow, req: PublishRequest) {
    const i = this.items.get(id);
    if (!i) return Promise.resolve(undefined);
    if (i.ownerId !== owner.id) return Promise.resolve("forbidden" as const);
    Object.assign(i, {
      title: req.title,
      description: req.description,
      visibility: req.visibility,
    });
    i.versions.push(req.design);
    i.updatedAt = new Date();
    return Promise.resolve(toItem(i));
  }
  get(id: string) {
    const i = this.items.get(id);
    const design = i?.versions.at(-1);
    return Promise.resolve(i && design ? { ...toItem(i), design } : undefined);
  }
  list(q: string, limit: number, offset: number) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const all = [...this.items.values()]
      .filter((i) => i.visibility === "public")
      .filter((i) =>
        words.every((w) => `${i.title} ${i.description} ${i.author}`.toLowerCase().includes(w)),
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return Promise.resolve(all.slice(offset, offset + limit).map(toItem));
  }
  remove(id: string, owner: UserRow) {
    const i = this.items.get(id);
    if (!i) return Promise.resolve(false);
    if (i.ownerId !== owner.id) return Promise.resolve("forbidden" as const);
    this.items.delete(id);
    return Promise.resolve(true);
  }
  countFork(id: string) {
    const i = this.items.get(id);
    if (i) i.forks++;
    return Promise.resolve();
  }
}
