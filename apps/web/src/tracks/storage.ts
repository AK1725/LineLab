"use client";

import { Track } from "@linelab/schema";
import { createStore, del, entries, get, set, type UseStore } from "idb-keyval";
import { z } from "zod";

/** Steps of the turtle editor; kept so a track built in the editor stays editable. */
export const Step = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("forward"), mm: z.number().positive() }),
  z.object({
    kind: z.literal("turn"),
    deg: z.number().refine((v) => v !== 0),
    radiusMm: z.number().positive(),
  }),
  z.object({ kind: z.literal("gap"), mm: z.number().positive() }),
  z.object({ kind: z.literal("invert"), mm: z.number().positive() }),
]);
export type Step = z.infer<typeof Step>;

const Saved = z.object({ track: Track, steps: z.array(Step).optional(), updatedAt: z.number() });
export type SavedTrack = z.infer<typeof Saved>;

let store: UseStore | undefined;
const db = () => (store ??= createStore("linelab-tracks", "tracks"));

export async function saveTrack(track: Track, steps?: Step[]) {
  await set(track.id, { track, ...(steps ? { steps } : {}), updatedAt: Date.now() }, db());
}

export async function loadTrack(id: string): Promise<SavedTrack | undefined> {
  const parsed = Saved.safeParse(await get(id, db()));
  return parsed.success ? parsed.data : undefined;
}

export async function listTracks(): Promise<SavedTrack[]> {
  return (await entries(db()))
    .map(([, v]) => Saved.safeParse(v))
    .flatMap((r) => (r.success ? [r.data] : []))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteTrack(id: string) {
  await del(id, db());
}

export const newTrackId = () => `track.custom-${crypto.randomUUID().slice(0, 8)}`;
