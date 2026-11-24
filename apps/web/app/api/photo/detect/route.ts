/**
 * Proxies robot-photo detection to the LineLab API (apps/api), which calls the vision model.
 * A user's own Anthropic key travels in x-anthropic-api-key and is not stored anywhere.
 */
export const dynamic = "force-dynamic";

const MAX_BYTES = 40 * 1024 * 1024;

export async function POST(req: Request): Promise<Response> {
  if (Number(req.headers.get("content-length") ?? "0") > MAX_BYTES)
    return Response.json({ error: "The photos are larger than 40 MB in total." }, { status: 413 });
  const base = process.env.API_URL ?? "http://localhost:4000";
  const headers: Record<string, string> = { "content-type": "application/json" };
  const key = req.headers.get("x-anthropic-api-key");
  if (key) headers["x-anthropic-api-key"] = key;
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) headers["x-forwarded-for"] = fwd;
  try {
    const res = await fetch(`${base}/photo/detect`, {
      method: "POST",
      headers,
      body: await req.text(),
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(180_000)]),
    });
    return new Response(res.body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
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
