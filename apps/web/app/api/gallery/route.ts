import { proxyToApi } from "../../../src/lib/api-proxy";

/** Proxies /api/gallery (list, publish) to the LineLab API. */
export const dynamic = "force-dynamic";

export const GET = (req: Request) => proxyToApi(req, "/gallery");
export const POST = (req: Request) => proxyToApi(req, "/gallery");
