import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const apiPort = 4100;
const isCI = process.env.CI !== undefined;

export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Production build, served the way users get it. Turbo caches the build.
      command: `pnpm -w exec turbo run build --filter=@linelab/web && pnpm --filter @linelab/web exec next start --port ${port}`,
      url: `http://localhost:${port}`,
      reuseExistingServer: !isCI,
      timeout: 240_000,
      env: { API_URL: `http://localhost:${apiPort}` },
    },
    {
      // The API, with the AI debugger replaying a scripted transcript (no API key in tests) and
      // compiling from the committed cache of real compiler output.
      command: `pnpm -w exec turbo run build --filter=@linelab/api... && node ../apps/api/dist/server.js`,
      url: `http://localhost:${apiPort}/health`,
      reuseExistingServer: !isCI,
      timeout: 240_000,
      env: {
        API_PORT: String(apiPort),
        LOG_LEVEL: "warn",
        LINELAB_AGENT_SCRIPT: "../examples/agent/blocking_delay.scripted.json",
        LINELAB_AGENT_PER_HOUR: "1000",
      },
    },
  ],
});
