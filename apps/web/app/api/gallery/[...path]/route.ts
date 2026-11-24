import { proxyToApi } from "../../../../src/lib/api-proxy";

/** Proxies /api/gallery/* to the LineLab API (cookies and redirects pass through). */
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };
const go = async (req: Request, ctx: Ctx) =>
  proxyToApi(req, `/gallery/${(await ctx.params).path.map(encodeURIComponent).join("/")}`);
export const GET = go;
export const POST = go;
export const PUT = go;
export const DELETE = go;
