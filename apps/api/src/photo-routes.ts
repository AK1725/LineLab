import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import {
  ClaudeVisionDetector,
  ScriptedDetector,
  VisionError,
  visionConfigFromEnv,
  type PhotoDetector,
} from "@linelab/photo-design";
import { DetectionResult, PhotoView } from "@linelab/schema";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

export interface PhotoDeps {
  /** The detector for a request: the user's own key when sent, else the server's (or a script). */
  detectorFor: (byoKey: string | undefined) => PhotoDetector | undefined;
  /** Detections one client (IP) may request per hour. */
  perHour: number;
}

/**
 * - ANTHROPIC_API_KEY: the server's key (users can send their own per request,
 *   x-anthropic-api-key; never stored or logged).
 * - LINELAB_PHOTO_SCRIPT: a DetectionResult JSON file to replay instead of calling the API
 *   (demos, e2e). Results then say detector "scripted".
 */
export function photoDepsFromEnv(env: NodeJS.ProcessEnv = process.env): PhotoDeps {
  const config = visionConfigFromEnv(env);
  const script = env.LINELAB_PHOTO_SCRIPT;
  const scripted = script
    ? DetectionResult.parse(JSON.parse(readFileSync(script, "utf8")))
    : undefined;
  const serverKey = Boolean(env.ANTHROPIC_API_KEY ?? env.ANTHROPIC_AUTH_TOKEN);
  return {
    detectorFor: (byoKey) => {
      if (scripted) return new ScriptedDetector(scripted);
      if (byoKey) return new ClaudeVisionDetector(new Anthropic({ apiKey: byoKey }), config);
      return serverKey ? new ClaudeVisionDetector(new Anthropic(), config) : undefined;
    },
    perHour: Number(env.LINELAB_PHOTO_PER_HOUR ?? 20),
  };
}

/** ~5 MB images (base64), up to 8 photos, the top view required. */
const Body = z
  .object({
    photos: z
      .array(
        z
          .object({
            view: PhotoView,
            mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
            data: z
              .string()
              .min(16)
              .max(7_000_000)
              .regex(/^[A-Za-z0-9+/=]+$/, "base64 image data"),
          })
          .strict(),
      )
      .min(1)
      .max(8)
      .refine((ps) => ps.some((p) => p.view === "top"), "A top-view photo is required."),
  })
  .strict();

export function registerPhotoRoutes(app: FastifyInstance, deps: PhotoDeps): void {
  const hits = new Map<string, number[]>();
  const allow = (ip: string) => {
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= deps.perHour) return false;
    hits.set(ip, [...recent, now]);
    return true;
  };

  app.post("/photo/detect", { bodyLimit: 40 * 1024 * 1024 }, async (req, reply) => {
    const body = Body.safeParse(req.body);
    if (!body.success)
      return reply.code(400).send({
        error: body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      });
    const h = req.headers["x-anthropic-api-key"];
    const detector = deps.detectorFor(typeof h === "string" && h.trim() ? h.trim() : undefined);
    if (!detector)
      return reply.code(503).send({
        error:
          "No Anthropic API key is configured on this server. Enter your own key (used for this request only, never stored), or set ANTHROPIC_API_KEY if you host LineLab yourself.",
      });
    if (!allow(req.ip))
      return reply.code(429).send({ error: "Too many photo analyses this hour. Try again later." });
    const ac = new AbortController();
    req.raw.on("close", () => {
      if (!reply.sent) ac.abort();
    });
    try {
      return await detector.detect(body.data.photos, ac.signal);
    } catch (err) {
      if (err instanceof VisionError)
        return reply.code(422).send({ error: err.message, kind: err.kind });
      req.log.error({ err: (err as Error).message }, "photo detection failed");
      return reply
        .code(502)
        .send({ error: "The vision model could not be reached. Try again in a minute." });
    }
  });
}
