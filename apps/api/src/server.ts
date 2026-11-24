import { agentDepsFromEnv } from "./agent-deps.js";
import { buildApp } from "./app.js";
import { authConfigFromEnv } from "./auth.js";
import { openKnowledge, openStore } from "./knowledge.js";
import { photoDepsFromEnv } from "./photo-routes.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const knowledge = await openKnowledge(process.env);
const store = await openStore(process.env);
const app = buildApp(config, {
  agent: agentDepsFromEnv(process.env, knowledge),
  photo: photoDepsFromEnv(),
  store,
  auth: authConfigFromEnv(process.env, (m) => {
    console.info(m);
  }),
});

const shutdown = (signal: string) => {
  app.log.info({ signal }, "shutting down");
  app.close().then(
    () => process.exit(0),
    (err: unknown) => {
      app.log.error(err);
      process.exit(1);
    },
  );
};
process.on("SIGINT", () => {
  shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});

await app.listen({ port: config.API_PORT, host: config.API_HOST });
