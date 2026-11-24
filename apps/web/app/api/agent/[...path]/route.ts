/**
 * Proxies the AI debugger to the LineLab API (apps/api), streaming server-sent events through.
 * Set API_URL (default http://localhost:4000). A user's own Anthropic key travels in the
 * x-anthropic-api-key header to the API and is not stored anywhere.
 */
export const dynamic = "force-dynamic";

async function forward(req: Request, path: string[]): Promise<Response> {
  const base = process.env.API_URL ?? "http://localhost:4000";
  const url = `${base}/agent/${path.map(encodeURIComponent).join("/")}`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  const key = req.headers.get("x-anthropic-api-key");
  if (key) headers["x-anthropic-api-key"] = key;
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) headers["x-forwarded-for"] = fwd;
  try {
    const res = await fetch(url, {
      method: req.method,
      headers,
      ...(req.method === "POST" ? { body: await req.text() } : {}),
      signal: req.signal,
    });
    return new Response(res.body, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/json",
        "cache-control": "no-cache",
      },
    });
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

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await ctx.params).path);
}
export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await ctx.params).path);
}
