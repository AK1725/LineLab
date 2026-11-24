import { agentDepsFromEnv } from "./agent-deps.js";
import { buildApp } from "./app.js";
import { photoDepsFromEnv } from "./photo-routes.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = buildApp(config, { agent: agentDepsFromEnv(), photo: photoDepsFromEnv() });

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
