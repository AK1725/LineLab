import Fastify, { type FastifyInstance } from "fastify";
import { registerAgentRoutes, type AgentDeps } from "./agent-routes.js";
import { registerAuthRoutes, type AuthConfig } from "./auth.js";
import { registerGalleryRoutes } from "./gallery-routes.js";
import { registerPhotoRoutes, type PhotoDeps } from "./photo-routes.js";
import type { Store } from "./store.js";
import type { Config } from "./config.js";

export const SERVICE_NAME = "linelab-api";
export const API_VERSION = "0.0.0";

export function buildApp(
  config: Pick<Config, "LOG_LEVEL">,
  deps: { agent?: AgentDeps; photo?: PhotoDeps; store?: Store; auth?: AuthConfig } = {},
): FastifyInstance {
  // Requests carry whole designs and sketches.
  const app = Fastify({ logger: { level: config.LOG_LEVEL }, bodyLimit: 4 * 1024 * 1024 });

  app.get("/health", () => ({ status: "ok", service: SERVICE_NAME, version: API_VERSION }));

  if (deps.agent) registerAgentRoutes(app, deps.agent);
  if (deps.photo) registerPhotoRoutes(app, deps.photo);
  if (deps.store) {
    const auth = registerAuthRoutes(app, deps.store, deps.auth);
    registerGalleryRoutes(app, deps.store, auth);
  }

  return app;
}
