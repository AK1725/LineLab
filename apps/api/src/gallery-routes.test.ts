import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { readSession, safeNext, sessionCookieValue, type AuthConfig } from "./auth.js";
import { PgStore } from "./db/pg-store.js";
import { MemoryStore, type Store } from "./store.js";

const design = JSON.parse(
  readFileSync(
    join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "packages",
      "sim-core",
      "fixtures",
      "reference.design.json",
    ),
    "utf8",
  ),
) as Record<string, unknown>;
const SECRET = "x".repeat(40);
const logged: string[] = [];
const auth = (over: Partial<AuthConfig> = {}): AuthConfig => ({
  secret: SECRET,
  publicUrl: "http://web.test",
  mailer: {
    send: (_to, link) => {
      logged.push(link);
      return Promise.resolve();
    },
  },
  devLinks: false,
  secureCookies: false,
  ...over,
});

const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((c) => c()));
});
function app(store: Store = new MemoryStore(), cfg: AuthConfig | null = auth()) {
  const a = buildApp({ LOG_LEVEL: "silent" }, { store, ...(cfg ? { auth: cfg } : {}) });
  closers.push(() => a.close());
  return a;
}
const cookieOf = (setCookie: string | string[] | undefined) =>
  [setCookie ?? []]
    .flat()
    .map((c) => c.split(";")[0])
    .find((c) => c?.startsWith("ll_session=")) ?? "";

async function emailSignIn(a: ReturnType<typeof app>, email: string) {
  const start = await a.inject({
    method: "POST",
    url: "/auth/email/start",
    payload: { email, next: "/gallery?mine=1" },
  });
  expect(start.statusCode).toBe(200);
  const link = new URL(logged.at(-1) ?? "");
  expect(link.origin).toBe("http://web.test");
  const cb = await a.inject({ method: "GET", url: `/auth/email/callback${link.search}` });
  expect(cb.statusCode).toBe(303);
  expect(cb.headers.location).toBe("http://web.test/gallery?mine=1");
  // One-time link.
  expect(
    (await a.inject({ method: "GET", url: `/auth/email/callback${link.search}` })).statusCode,
  ).toBe(400);
  return cookieOf(cb.headers["set-cookie"]);
}

describe("sessions", () => {
  it("signs cookies, rejects tampering and expiry", () => {
    const v = sessionCookieValue(SECRET, "u1", 0);
    expect(readSession(SECRET, v, 1000)).toBe("u1");
    expect(readSession(SECRET, `${v}x`, 1000)).toBeUndefined();
    expect(readSession("y".repeat(40), v, 1000)).toBeUndefined();
    expect(readSession(SECRET, v, 31 * 24 * 3600 * 1000)).toBeUndefined();
  });
  it("only redirects to same-site paths after sign-in", () => {
    expect(safeNext("/gallery/abc")).toBe("/gallery/abc");
    for (const bad of [
      "https://evil.test",
      "//evil.test",
      "/\\evil.test",
      "javascript:alert(1)",
      5,
    ])
      expect(safeNext(bad)).toBe("/gallery");
  });
});

describe("gallery", () => {
  it("publishes when signed in, lists public items, keeps unlisted ones link-only, versions, forks, deletes", async () => {
    const a = app();
    const anon = await a.inject({
      method: "POST",
      url: "/gallery",
      payload: { title: "x", design },
    });
    expect(anon.statusCode).toBe(401);
    const cookie = await emailSignIn(a, "Ada@Example.com");
    const session = await a.inject({ method: "GET", url: "/auth/session", headers: { cookie } });
    expect(session.json()).toMatchObject({ user: { name: "ada", provider: "email" } });

    const pub = await a.inject({
      method: "POST",
      url: "/gallery",
      headers: { cookie },
      payload: { title: "Racer", description: "fast", design },
    });
    expect(pub.statusCode).toBe(201);
    const id = pub.json<{ id: string }>().id;
    const hidden = await a.inject({
      method: "POST",
      url: "/gallery",
      headers: { cookie },
      payload: { title: "Secret", visibility: "unlisted", design },
    });
    const hid = hidden.json<{ id: string }>().id;

    const list = await a.inject({ method: "GET", url: "/gallery?q=racer" });
    expect(list.json<{ items: { id: string }[] }>().items.map((i) => i.id)).toEqual([id]);
    expect(
      (await a.inject({ method: "GET", url: "/gallery" })).json<{ items: unknown[] }>().items,
    ).toHaveLength(1);
    expect((await a.inject({ method: "GET", url: `/gallery/${hid}` })).statusCode).toBe(200);

    const v2 = await a.inject({
      method: "PUT",
      url: `/gallery/${id}`,
      headers: { cookie },
      payload: { title: "Racer v2", design },
    });
    expect(v2.json()).toMatchObject({ version: 2, title: "Racer v2" });

    const other = await emailSignIn(a, "bob@example.com");
    expect(
      (
        await a.inject({
          method: "PUT",
          url: `/gallery/${id}`,
          headers: { cookie: other },
          payload: { title: "mine", design },
        })
      ).statusCode,
    ).toBe(403);
    await a.inject({ method: "POST", url: `/gallery/${id}/fork` });
    const fork = await a.inject({
      method: "POST",
      url: "/gallery",
      headers: { cookie: other },
      payload: { title: "Bob's racer", design, forkedFrom: id },
    });
    expect(fork.json()).toMatchObject({ forkedFrom: id, author: "bob" });
    expect((await a.inject({ method: "GET", url: `/gallery/${id}` })).json()).toMatchObject({
      forks: 1,
      design: { id: design.id },
    });

    expect(
      (await a.inject({ method: "DELETE", url: `/gallery/${id}`, headers: { cookie: other } }))
        .statusCode,
    ).toBe(403);
    expect(
      (await a.inject({ method: "DELETE", url: `/gallery/${id}`, headers: { cookie } })).statusCode,
    ).toBe(200);
    expect((await a.inject({ method: "GET", url: `/gallery/${id}` })).statusCode).toBe(404);
  });

  it("says sign-in isn't configured when there's no AUTH_SECRET", async () => {
    const a = app(new MemoryStore(), null);
    expect((await a.inject({ method: "GET", url: "/auth/providers" })).json()).toEqual({
      enabled: false,
      github: false,
      email: false,
    });
    expect(
      (await a.inject({ method: "POST", url: "/gallery", payload: { title: "x", design } }))
        .statusCode,
    ).toBe(503);
  });

  it("rejects an invalid design", async () => {
    const a = app();
    const cookie = await emailSignIn(a, "c@example.com");
    const r = await a.inject({
      method: "POST",
      url: "/gallery",
      headers: { cookie },
      payload: { title: "x", design: { id: "bad" } },
    });
    expect(r.statusCode).toBe(400);
  });
});

describe("GitHub sign-in (against a fake GitHub)", () => {
  it("checks state, exchanges the code, and signs in as the GitHub login", async () => {
    const gh: Server = createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/login/oauth/access_token") res.end(JSON.stringify({ access_token: "tok" }));
      else if (req.url === "/user" && req.headers.authorization === "Bearer tok")
        res.end(JSON.stringify({ id: 42, login: "octo" }));
      else res.writeHead(404).end("{}");
    });
    await new Promise<void>((r) => gh.listen(0, "127.0.0.1", r));
    closers.push(() => new Promise((r) => gh.close(r)));
    const base = `http://127.0.0.1:${String((gh.address() as AddressInfo).port)}`;
    const a = app(
      new MemoryStore(),
      auth({ github: { clientId: "cid", clientSecret: "cs", oauthUrl: base, apiUrl: base } }),
    );
    const start = await a.inject({ method: "GET", url: "/auth/github/start?next=/gallery/new" });
    expect(start.statusCode).toBe(302);
    const to = new URL(start.headers.location ?? "");
    expect(to.searchParams.get("redirect_uri")).toBe("http://web.test/api/auth/github/callback");
    const stateCookie =
      [start.headers["set-cookie"] ?? []]
        .flat()
        .map((c) => c.split(";")[0])
        .find((c) => c?.startsWith("ll_oauth_state=")) ?? "";
    const forged = await a.inject({
      method: "GET",
      url: "/auth/github/callback?code=c&state=forged",
      headers: { cookie: stateCookie },
    });
    expect(forged.statusCode).toBe(400);
    const ok = await a.inject({
      method: "GET",
      url: `/auth/github/callback?code=c&state=${to.searchParams.get("state") ?? ""}`,
      headers: { cookie: stateCookie },
    });
    expect(ok.statusCode).toBe(303);
    expect(ok.headers.location).toBe("http://web.test/gallery/new");
    const s = await a.inject({
      method: "GET",
      url: "/auth/session",
      headers: { cookie: cookieOf(ok.headers["set-cookie"]) },
    });
    expect(s.json()).toMatchObject({ user: { name: "octo", provider: "github" } });
  });
});

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("PgStore (Postgres)", () => {
  it("runs the same gallery flow on Postgres", async () => {
    const store = await PgStore.connect(url ?? "");
    closers.push(() => store.close());
    const a = app(store);
    const cookie = await emailSignIn(a, `pg-${String(Date.now())}@example.com`);
    const pub = await a.inject({
      method: "POST",
      url: "/gallery",
      headers: { cookie },
      payload: { title: `Pg racer ${String(Date.now())}`, design },
    });
    expect(pub.statusCode).toBe(201);
    const id = pub.json<{ id: string }>().id;
    const v2 = await a.inject({
      method: "PUT",
      url: `/gallery/${id}`,
      headers: { cookie },
      payload: { title: "Pg racer 2", design },
    });
    expect(v2.json()).toMatchObject({ version: 2 });
    await a.inject({ method: "POST", url: `/gallery/${id}/fork` });
    expect((await a.inject({ method: "GET", url: `/gallery/${id}` })).json()).toMatchObject({
      version: 2,
      forks: 1,
    });
    expect(
      (await a.inject({ method: "GET", url: "/gallery?q=Pg%20racer%202" }))
        .json<{ items: { id: string }[] }>()
        .items.some((i) => i.id === id),
    ).toBe(true);
    expect(
      (await a.inject({ method: "DELETE", url: `/gallery/${id}`, headers: { cookie } })).statusCode,
    ).toBe(200);
  });
});
