/**
 * Proxies track-image uploads to the Python vision service (apps/vision), so the browser only
 * talks to this origin. Set VISION_URL (default http://localhost:8000).
 */
export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(req: Request): Promise<Response> {
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > MAX_BYTES)
    return Response.json({ detail: "Image is larger than 25 MB." }, { status: 413 });
  const base = process.env.VISION_URL ?? "http://localhost:8000";
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ detail: "Expected a multipart form upload." }, { status: 400 });
  }
  try {
    const res = await fetch(`${base}/track/from-image`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    const body: unknown = await res.json();
    return Response.json(body, { status: res.status });
  } catch {
    return Response.json(
      {
        detail:
          "The vision service is not running. Start it with `pnpm --filter @linelab/vision dev` (or `docker compose --profile apps up`).",
      },
      { status: 503 },
    );
  }
}
