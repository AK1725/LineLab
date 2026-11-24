/**
 * Forwards a request to the LineLab API (apps/api) with its cookies, and passes the response back
 * as-is, including Set-Cookie and redirects (sign-in flows). API_URL defaults to localhost:4000.
 */
export async function proxyToApi(req: Request, path: string): Promise<Response> {
  const base = process.env.API_URL ?? "http://localhost:4000";
  const src = new URL(req.url);
  const headers: Record<string, string> = {};
  for (const h of ["content-type", "cookie", "x-forwarded-for", "accept"]) {
    const v = req.headers.get(h);
    if (v) headers[h] = v;
  }
  try {
    const res = await fetch(`${base}${path}${src.search}`, {
      method: req.method,
      headers,
      ...(req.method === "GET" || req.method === "HEAD" ? {} : { body: await req.text() }),
      redirect: "manual",
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(30_000)]),
    });
    const out = new Headers();
    for (const h of ["content-type", "location", "cache-control"]) {
      const v = res.headers.get(h);
      if (v) out.set(h, v);
    }
    for (const c of res.headers.getSetCookie()) out.append("set-cookie", c);
    return new Response(res.status === 204 ? null : res.body, { status: res.status, headers: out });
  } catch {
    return Response.json(
      {
        error:
          "The LineLab API isn't running. Start it with `pnpm --filter @linelab/api dev` (or `docker compose --profile apps up`).",
      },
      { status: 503 },
    );
  }
}
