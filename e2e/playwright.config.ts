import { defineConfig, devices } from "@playwright/test";

const port = 3100;
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
  webServer: {
    // Production build, served the way users get it. Turbo caches the build.
    command: `pnpm -w exec turbo run build --filter=@linelab/web && pnpm --filter @linelab/web exec next start --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !isCI,
    timeout: 240_000,
  },
});
