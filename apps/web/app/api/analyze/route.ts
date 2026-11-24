/**
 * Proxies static-analysis requests (cppcheck, clang-tidy) to the sandboxed compiler service (apps/compiler). Set COMPILER_URL
 * (default http://localhost:8100). The browser never talks to the compiler directly.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const base = process.env.COMPILER_URL ?? "http://localhost:8100";
  let body: string;
  try {
    body = await req.text();
    if (body.length > 1024 * 1024)
      return Response.json({ error: "Sketch is larger than 1 MB." }, { status: 413 });
  } catch {
    return Response.json({ error: "Couldn't read the request." }, { status: 400 });
  }
  try {
    const res = await fetch(`${base}/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(90_000),
    });
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json(
      {
        error:
          "The compiler service isn't running. Start it with `docker compose --profile apps up compiler` (or `pnpm --filter @linelab/compiler dev` with arduino-cli installed).",
      },
      { status: 503 },
    );
  }
}
