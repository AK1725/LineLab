import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SessionUser } from "@linelab/schema";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { SmtpMailer } from "./mailer.js";
import type { Store, UserRow } from "./store.js";

/** Sends a sign-in link. `LogMailer` prints it to the server log (self-hosting, development). */
export interface Mailer {
  send(to: string, link: string): Promise<void>;
}
export class LogMailer implements Mailer {
  constructor(private readonly log: (msg: string) => void) {}
  send(to: string, link: string) {
    this.log(`Sign-in link for ${to}: ${link}`);
    return Promise.resolve();
  }
}

export interface AuthConfig {
  /** HMAC key for session cookies (≥ 32 chars). Without it sign-in is off. */
  secret: string;
  /** The web app's origin, for redirects and links (e.g. http://localhost:3000). */
  publicUrl: string;
  github?: { clientId: string; clientSecret: string; oauthUrl: string; apiUrl: string };
  mailer?: Mailer;
  /** Development/tests only: return the email sign-in link in the response. Refused in production. */
  devLinks: boolean;
  secureCookies: boolean;
}

export function authConfigFromEnv(
  env: NodeJS.ProcessEnv,
  log: (m: string) => void,
): AuthConfig | undefined {
  const secret = env.AUTH_SECRET ?? "";
  if (secret.length < 32) return undefined;
  const publicUrl = (env.PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const devLinks = env.LINELAB_AUTH_DEV_LINKS === "1";
  if (devLinks && env.NODE_ENV === "production")
    throw new Error("LINELAB_AUTH_DEV_LINKS must not be set in production.");
  return {
    secret,
    publicUrl,
    ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET,
            oauthUrl: env.GITHUB_OAUTH_URL ?? "https://github.com",
            apiUrl: env.GITHUB_API_URL ?? "https://api.github.com",
          },
        }
      : {}),
    // Email sign-in: by SMTP when configured, else (self-hosting, development) to the log.
    ...(env.SMTP_URL
      ? { mailer: new SmtpMailer(env.SMTP_URL, env.MAIL_FROM ?? "LineLab <no-reply@localhost>") }
      : env.LINELAB_MAIL === "log" || devLinks
        ? { mailer: new LogMailer(log) }
        : {}),
    devLinks,
    secureCookies: publicUrl.startsWith("https://"),
  };
}

const COOKIE = "ll_session";
const STATE = "ll_oauth_state";
const SESSION_S = 30 * 24 * 3600;

const b64u = (b: Buffer) => b.toString("base64url");
const sign = (secret: string, data: string) =>
  b64u(createHmac("sha256", secret).update(data).digest());
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function sessionCookieValue(secret: string, userId: string, now = Date.now()): string {
  const body = b64u(
    Buffer.from(JSON.stringify({ u: userId, e: Math.floor(now / 1000) + SESSION_S })),
  );
  return `${body}.${sign(secret, body)}`;
}

export function readSession(
  secret: string,
  value: string | undefined,
  now = Date.now(),
): string | undefined {
  if (!value) return undefined;
  const [body, mac] = value.split(".");
  if (!body || !mac) return undefined;
  const want = Buffer.from(sign(secret, body));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return undefined;
  try {
    const p = z
      .object({ u: z.string(), e: z.number() })
      .parse(JSON.parse(Buffer.from(body, "base64url").toString()));
    return p.e * 1000 > now ? p.u : undefined;
  } catch {
    return undefined;
  }
}

export const cookies = (req: FastifyRequest): Record<string, string> =>
  Object.fromEntries(
    (req.headers.cookie ?? "")
      .split(";")
      .map((c) => c.trim().split("="))
      .filter((kv): kv is [string, string] => kv.length >= 2 && Boolean(kv[0]))
      .map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]),
  );

/** Only same-site relative paths, so sign-in can't be used as an open redirect. */
export const safeNext = (next: unknown) =>
  typeof next === "string" && /^\/(?![/\\])[\w\-./?=&%#]*$/.test(next) ? next : "/gallery";

export interface Auth {
  config: AuthConfig | undefined;
  user(req: FastifyRequest): Promise<UserRow | undefined>;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  store: Store,
  config: AuthConfig | undefined,
): Auth {
  const setCookie = (reply: FastifyReply, name: string, value: string, maxAge: number) => {
    const parts = [
      `${name}=${encodeURIComponent(value)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${String(maxAge)}`,
    ];
    if (config?.secureCookies) parts.push("Secure");
    void reply.header("set-cookie", [
      ...[reply.getHeader("set-cookie") ?? []].flat().map(String),
      parts.join("; "),
    ]);
  };
  const signIn = async (
    reply: FastifyReply,
    key: string,
    name: string,
    provider: SessionUser["provider"],
    next: string,
  ) => {
    if (!config) return reply.code(503).send({ error: "Sign-in isn't configured on this server." });
    const u = await store.upsertUser(key, name, provider);
    setCookie(reply, COOKIE, sessionCookieValue(config.secret, u.id), SESSION_S);
    return reply.redirect(`${config.publicUrl}${next}`, 303);
  };
  const user = async (req: FastifyRequest) => {
    if (!config) return undefined;
    const id = readSession(config.secret, cookies(req)[COOKIE]);
    return id ? store.getUser(id) : undefined;
  };
  const emailHits = new Map<string, number[]>();

  app.get("/auth/providers", () => ({
    enabled: config !== undefined,
    github: config?.github !== undefined,
    email: config?.mailer !== undefined,
  }));

  app.get("/auth/session", async (req) => {
    const u = await user(req);
    return { user: u ? { id: u.id, name: u.name, provider: u.provider } : null };
  });

  app.post("/auth/logout", (_req, reply) => {
    setCookie(reply, COOKIE, "", 0);
    return { ok: true };
  });

  app.get<{ Querystring: { next?: string } }>("/auth/github/start", (req, reply) => {
    const gh = config?.github;
    if (!gh) return reply.code(404).send({ error: "GitHub sign-in isn't configured." });
    const state = b64u(randomBytes(24));
    setCookie(reply, STATE, `${state}|${safeNext(req.query.next)}`, 600);
    const u = new URL(`${gh.oauthUrl}/login/oauth/authorize`);
    u.searchParams.set("client_id", gh.clientId);
    u.searchParams.set("redirect_uri", `${config.publicUrl}/api/auth/github/callback`);
    u.searchParams.set("scope", "read:user");
    u.searchParams.set("state", state);
    return reply.redirect(u.toString(), 302);
  });

  app.get<{ Querystring: { code?: string; state?: string } }>(
    "/auth/github/callback",
    async (req, reply) => {
      const gh = config?.github;
      if (!gh) return reply.code(404).send({ error: "GitHub sign-in isn't configured." });
      const [state, next] = (cookies(req)[STATE] ?? "").split("|");
      setCookie(reply, STATE, "", 0);
      if (!state || !req.query.state || state !== req.query.state || !req.query.code)
        return reply.code(400).send({ error: "Sign-in expired or was tampered with. Try again." });
      try {
        const tok = (await (
          await fetch(`${gh.oauthUrl}/login/oauth/access_token`, {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify({
              client_id: gh.clientId,
              client_secret: gh.clientSecret,
              code: req.query.code,
              redirect_uri: `${config.publicUrl}/api/auth/github/callback`,
            }),
            signal: AbortSignal.timeout(10_000),
          })
        ).json()) as { access_token?: string };
        if (!tok.access_token)
          return await reply.code(400).send({ error: "GitHub didn't accept the sign-in." });
        const me = z.object({ id: z.number(), login: z.string() }).parse(
          await (
            await fetch(`${gh.apiUrl}/user`, {
              headers: {
                authorization: `Bearer ${tok.access_token}`,
                accept: "application/vnd.github+json",
              },
              signal: AbortSignal.timeout(10_000),
            })
          ).json(),
        );
        return await signIn(reply, `github:${String(me.id)}`, me.login, "github", safeNext(next));
      } catch (err) {
        req.log.warn({ err: (err as Error).message }, "github sign-in failed");
        return reply.code(502).send({ error: "Couldn't reach GitHub. Try again." });
      }
    },
  );

  app.post("/auth/email/start", async (req, reply) => {
    if (!config?.mailer) return reply.code(404).send({ error: "Email sign-in isn't configured." });
    const body = z
      .object({ email: z.email().max(254), next: z.string().max(500).optional() })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Enter a valid email address." });
    const email = body.data.email.toLowerCase();
    const now = Date.now();
    for (const k of [req.ip, email]) {
      const recent = (emailHits.get(k) ?? []).filter((t) => now - t < 3_600_000);
      if (recent.length >= 5)
        return reply.code(429).send({ error: "Too many sign-in emails. Try again later." });
      emailHits.set(k, [...recent, now]);
    }
    const token = b64u(randomBytes(32));
    await store.putLoginToken(sha256(token), email, new Date(now + 15 * 60_000));
    const link = `${config.publicUrl}/api/auth/email/callback?token=${token}&next=${encodeURIComponent(safeNext(body.data.next))}`;
    await config.mailer.send(email, link);
    return { sent: true, ...(config.devLinks ? { devLink: link } : {}) };
  });

  app.get<{ Querystring: { token?: string; next?: string } }>(
    "/auth/email/callback",
    async (req, reply) => {
      const email = req.query.token
        ? await store.takeLoginToken(sha256(req.query.token))
        : undefined;
      if (!email)
        return reply
          .code(400)
          .send({ error: "This sign-in link has expired or was already used." });
      return signIn(
        reply,
        `email:${email}`,
        email.split("@")[0] ?? email,
        "email",
        safeNext(req.query.next),
      );
    },
  );

  return { config, user };
}
