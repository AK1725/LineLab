import { z } from "zod";
import { Design } from "./design.js";

/** A published robot in the gallery (BLUEPRINT §2.2 K). */
export const GalleryItem = z
  .object({
    id: z.string().regex(/^[a-z0-9]{8,16}$/),
    title: z.string().min(1).max(80),
    description: z.string().max(2000),
    /** Display name of the publisher (GitHub login or the part of the email before @). */
    author: z.string(),
    version: z.number().int().positive(),
    /** The gallery item this was forked from, if any. */
    forkedFrom: z.string().optional(),
    forks: z.number().int().nonnegative(),
    /** "unlisted": reachable by link only. */
    visibility: z.enum(["public", "unlisted"]),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type GalleryItem = z.infer<typeof GalleryItem>;

export const GalleryDetail = GalleryItem.extend({ design: Design }).strict();
export type GalleryDetail = z.infer<typeof GalleryDetail>;

export const PublishRequest = z
  .object({
    title: z.string().trim().min(1).max(80),
    description: z.string().max(2000).default(""),
    visibility: z.enum(["public", "unlisted"]).default("public"),
    design: Design,
    forkedFrom: z.string().optional(),
  })
  .strict();
export type PublishRequest = z.infer<typeof PublishRequest>;

export const SessionUser = z
  .object({ id: z.string(), name: z.string(), provider: z.enum(["github", "email"]) })
  .strict();
export type SessionUser = z.infer<typeof SessionUser>;
