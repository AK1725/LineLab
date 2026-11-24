/** Proxies a top-view robot photo to the vision service (apps/vision) for its silhouette. */
export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(req: Request): Promise<Response> {
  if (Number(req.headers.get("content-length") ?? "0") > MAX_BYTES)
    return Response.json({ detail: "Image is larger than 25 MB." }, { status: 413 });
  const base = process.env.VISION_URL ?? "http://localhost:8000";
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ detail: "Expected a multipart form upload." }, { status: 400 });
  }
  try {
    const res = await fetch(`${base}/robot/outline`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    return Response.json((await res.json()) as unknown, { status: res.status });
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
