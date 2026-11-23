// The compile service: POST /compile with a CompileRequest, get a CompileResponse.
// Run it in its container (apps/compiler/Dockerfile): no internet, CPU/memory limits, non-root.
import Fastify from "fastify";
import { CompileRequest } from "@linelab/schema";
import { compile } from "./compile.js";
import { configFromEnv } from "./config.js";

const MAX_RUNNING = 2;
const MAX_QUEUED = 8;

export function buildServer(cfg = configFromEnv()) {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", bodyLimit: 2 * 1024 * 1024 });
  let running = 0;
  const queue: (() => void)[] = [];
  const slot = () =>
    new Promise<void>((res) => {
      if (running < MAX_RUNNING) {
        running++;
        res();
      } else
        queue.push(() => {
          running++;
          res();
        });
    });
  const release = () => {
    running--;
    queue.shift()?.();
  };

  app.get("/health", () => ({ ok: true, running, queued: queue.length }));
  app.post("/compile", async (req, reply) => {
    const parsed = CompileRequest.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    if (queue.length >= MAX_QUEUED)
      return reply.code(429).send({ error: "The compiler is busy; try again in a few seconds." });
    await slot();
    try {
      return await compile(parsed.data, cfg);
    } finally {
      release();
    }
  });
  return app;
}

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  const app = buildServer();
  await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 8100) });
}
