import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.js";

export const SERVICE_NAME = "linelab-api";
export const API_VERSION = "0.0.0";

export function buildApp(config: Pick<Config, "LOG_LEVEL">): FastifyInstance {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });

  app.get("/health", () => ({ status: "ok", service: SERVICE_NAME, version: API_VERSION }));

  return app;
}
