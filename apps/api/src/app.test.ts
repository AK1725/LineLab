import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

describe("GET /health", () => {
  it("reports ok", async () => {
    const app = buildApp({ LOG_LEVEL: "silent" });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", service: "linelab-api", version: "0.0.0" });
    await app.close();
  });

  it("returns 404 for unknown routes", async () => {
    const app = buildApp({ LOG_LEVEL: "silent" });
    const res = await app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("loadConfig", () => {
  it("applies defaults", () => {
    expect(loadConfig({})).toEqual({ API_PORT: 4000, API_HOST: "0.0.0.0", LOG_LEVEL: "info" });
  });

  it("fails fast on bad values", () => {
    expect(() => loadConfig({ API_PORT: "abc" })).toThrow(/Invalid API configuration: API_PORT/);
  });
});
