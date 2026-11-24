import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  agentConfigFromEnv,
  CachedCompiler,
  MemoryKnowledge,
  ScriptedModel,
  type AgentEvent,
  type ScriptedTurn,
} from "@linelab/agent";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentDeps } from "./agent-routes.js";
import { buildApp } from "./app.js";

const repo = join(import.meta.dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const turns = JSON.parse(read("examples/agent/blocking_delay.scripted.json")) as ScriptedTurn[];
const body = {
  design: JSON.parse(read("packages/sim-core/fixtures/reference.design.json")) as unknown,
  track: JSON.parse(read("tracks/track.oval.json")) as unknown,
  source: read("examples/firmware/buggy/blocking_delay/blocking_delay.ino"),
};

function deps(over: Partial<AgentDeps> = {}): AgentDeps {
  return {
    config: agentConfigFromEnv({}),
    compiler: new CachedCompiler(join(repo, "examples", "firmware", ".compile-cache")),
    knowledge: new MemoryKnowledge(),
    modelFor: () => new ScriptedModel(turns),
    limits: { perHour: 10, concurrent: 2 },
    ...over,
  };
}

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

async function listen(d: AgentDeps) {
  const app = buildApp({ LOG_LEVEL: "silent" }, { agent: d });
  apps.push(app);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  return `http://127.0.0.1:${String(addr.port)}`;
}

/** Read the SSE stream to the end. */
async function events(base: string, id: string): Promise<AgentEvent[]> {
  const res = await fetch(`${base}/agent/sessions/${id}/events`);
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((c) => c.startsWith("data: "))
    .map((c) => JSON.parse(c.slice(6)) as AgentEvent);
}

describe("/agent/sessions", () => {
  it("runs a session and streams events, ending with a verified patch", async () => {
    const base = await listen(deps());
    const res = await fetch(`${base}/agent/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const evs = await events(base, id);
    const done = evs.at(-1);
    expect(done?.type).toBe("done");
    expect(evs.some((e) => e.type === "verified")).toBe(true);
    expect(evs.some((e) => e.type === "text")).toBe(true);
    const state = (await (await fetch(`${base}/agent/sessions/${id}`)).json()) as {
      done: boolean;
      result: { status: string; model: string };
    };
    expect(state).toMatchObject({ done: true, result: { status: "fixed", model: "scripted" } });
  }, 120_000);

  it("asks for a key when the server has none, and passes a user's own key through", async () => {
    const keys: (string | undefined)[] = [];
    const app = buildApp(
      { LOG_LEVEL: "silent" },
      {
        agent: deps({ modelFor: (k) => (keys.push(k), k ? new ScriptedModel(turns) : undefined) }),
      },
    );
    apps.push(app);
    const none = await app.inject({ method: "POST", url: "/agent/sessions", payload: body });
    expect(none.statusCode).toBe(503);
    expect(none.json<{ error: string }>().error).toMatch(/Enter your own key/);
    const own = await app.inject({
      method: "POST",
      url: "/agent/sessions",
      payload: body,
      headers: { "x-anthropic-api-key": "sk-ant-user" },
    });
    expect(own.statusCode).toBe(201);
    expect(keys).toEqual([undefined, "sk-ant-user"]);
  }, 120_000);

  it("rate-limits sessions per client and validates the body", async () => {
    const app = buildApp(
      { LOG_LEVEL: "silent" },
      { agent: deps({ limits: { perHour: 1, concurrent: 5 } }) },
    );
    apps.push(app);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/agent/sessions",
          payload: { ...body, source: "" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: "POST", url: "/agent/sessions", payload: body })).statusCode,
    ).toBe(201);
    const third = await app.inject({ method: "POST", url: "/agent/sessions", payload: body });
    expect(third.statusCode).toBe(429);
  }, 120_000);

  it("feedback: success confirms the fix; failure restarts from the fixed sketch with the evidence", async () => {
    const d = deps();
    const base = await listen(d);
    const { id } = (await (
      await fetch(`${base}/agent/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    ).json()) as { id: string };
    await events(base, id);
    const ok = await fetch(`${base}/agent/sessions/${id}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worked: true, symptoms: [] }),
    });
    expect(await ok.json()).toEqual({ stored: true });
    expect((await d.knowledge.search("blocking delay loop")).length).toBe(1);

    const failed = await fetch(`${base}/agent/sessions/${id}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        worked: false,
        where: "first curve",
        symptoms: ["oscillates"],
        notes: "wobbles a lot",
      }),
    });
    expect(failed.status).toBe(201);
    const next = (await failed.json()) as { id: string };
    const evs = await events(base, next.id);
    expect(evs.at(-1)?.type).toBe("done");
    const state = (await (await fetch(`${base}/agent/sessions/${next.id}`)).json()) as {
      parent: string;
    };
    expect(state.parent).toBe(id);
  }, 180_000);
});
