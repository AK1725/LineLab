"use client";

import { Design } from "@linelab/schema";
import { createStore, del, entries, get, set, type UseStore } from "idb-keyval";

/** Designs live in the browser (IndexedDB) until accounts arrive in a later phase. */
export interface SavedDesign {
  design: Design;
  updatedAt: number;
}

let store: UseStore | undefined;
const db = () => (store ??= createStore("linelab", "designs"));

export async function saveDesign(design: Design): Promise<void> {
  await set(design.id, { design, updatedAt: Date.now() } satisfies SavedDesign, db());
}

export async function loadDesign(id: string): Promise<SavedDesign | undefined> {
  const raw: unknown = await get(id, db());
  return parseSaved(raw);
}

export async function listDesigns(): Promise<SavedDesign[]> {
  const all = await entries(db());
  return all
    .map(([, v]) => parseSaved(v))
    .filter((x): x is SavedDesign => x !== undefined)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteDesign(id: string): Promise<void> {
  await del(id, db());
}

/** Stored data is re-validated on read so an old or corrupted entry can't crash the editor. */
function parseSaved(raw: unknown): SavedDesign | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as { design?: unknown; updatedAt?: unknown };
  const parsed = Design.safeParse(r.design);
  if (!parsed.success || typeof r.updatedAt !== "number") return undefined;
  return { design: parsed.data, updatedAt: r.updatedAt };
}

export const newDesignId = () => `d-${crypto.randomUUID().slice(0, 8)}`;
