import { PublishRequest } from "@linelab/schema";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Auth } from "./auth.js";
import type { Store } from "./store.js";

const Id = z.string().regex(/^[a-z0-9]{8,16}$/);

/** The public gallery: publish (signed in), browse, view by link, new versions, fork, delete. */
export function registerGalleryRoutes(app: FastifyInstance, store: Store, auth: Auth): void {
  const need = async (req: Parameters<Auth["user"]>[0]) => auth.user(req);
  const bad = (e: z.ZodError) => ({
    error: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
  });

  app.get<{ Querystring: { q?: string; page?: string } }>("/gallery", async (req) => {
    const page = Math.max(0, Math.min(1000, Number(req.query.page ?? 0) || 0));
    return { items: await store.list((req.query.q ?? "").slice(0, 100), 24, page * 24), page };
  });

  app.get<{ Params: { id: string } }>("/gallery/:id", async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return reply.code(404).send({ error: "Not found." });
    const item = await store.get(req.params.id);
    return item ?? reply.code(404).send({ error: "Not found." });
  });

  app.post("/gallery", async (req, reply) => {
    const u = await need(req);
    if (!u)
      return reply.code(auth.config ? 401 : 503).send({
        error: auth.config ? "Sign in to publish." : "Sign-in isn't configured on this server.",
      });
    const body = PublishRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send(bad(body.error));
    return reply.code(201).send(await store.publish(u, body.data));
  });

  app.put<{ Params: { id: string } }>("/gallery/:id", async (req, reply) => {
    const u = await need(req);
    if (!u) return reply.code(401).send({ error: "Sign in to publish." });
    const body = PublishRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send(bad(body.error));
    const r = await store.update(req.params.id, u, body.data);
    if (r === "forbidden")
      return reply.code(403).send({ error: "Only the author can publish new versions." });
    return r ?? reply.code(404).send({ error: "Not found." });
  });

  app.delete<{ Params: { id: string } }>("/gallery/:id", async (req, reply) => {
    const u = await need(req);
    if (!u) return reply.code(401).send({ error: "Sign in first." });
    const r = await store.remove(req.params.id, u);
    if (r === "forbidden") return reply.code(403).send({ error: "Only the author can delete it." });
    return r ? { deleted: true } : reply.code(404).send({ error: "Not found." });
  });

  /** Forking happens in the browser (a local copy); this only counts it. */
  app.post<{ Params: { id: string } }>("/gallery/:id/fork", async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return reply.code(404).send({ error: "Not found." });
    await store.countFork(req.params.id);
    return { ok: true };
  });
}
