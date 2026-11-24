import { ScriptedDetector } from "@linelab/photo-design";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import type { PhotoDeps } from "./photo-routes.js";

const result = {
  frontInTop: "up" as const,
  notes: [],
  detections: [
    {
      id: "d1",
      category: "mcu" as const,
      description: "Arduino Nano",
      markings: ["NANO"],
      count: 1,
      confidence: 0.9,
    },
  ],
};
const photo = (view: string) => ({
  view,
  mediaType: "image/jpeg",
  data: "QUJDREVGR0hJSktMTU5PUA==",
});

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});
function app(over: Partial<PhotoDeps> = {}) {
  const a = buildApp(
    { LOG_LEVEL: "silent" },
    { photo: { detectorFor: () => new ScriptedDetector(result), perHour: 3, ...over } },
  );
  apps.push(a);
  return a;
}

describe("POST /photo/detect", () => {
  it("returns validated detections", async () => {
    const r = await app().inject({
      method: "POST",
      url: "/photo/detect",
      payload: { photos: [photo("top")] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ detector: "scripted", detections: [{ id: "d1" }] });
  });

  it("requires a top view and real base64", async () => {
    const a = app();
    const noTop = await a.inject({
      method: "POST",
      url: "/photo/detect",
      payload: { photos: [photo("left")] },
    });
    expect(noTop.statusCode).toBe(400);
    expect(noTop.json<{ error: string }>().error).toMatch(/top-view/);
    const bad = await a.inject({
      method: "POST",
      url: "/photo/detect",
      payload: { photos: [{ ...photo("top"), data: "<script>alert(1)</script>" }] },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("passes the user's own key to the detector, and says so when there is none", async () => {
    const seen: (string | undefined)[] = [];
    const a = app({
      detectorFor: (k) => {
        seen.push(k);
        return k ? new ScriptedDetector(result) : undefined;
      },
    });
    const none = await a.inject({
      method: "POST",
      url: "/photo/detect",
      payload: { photos: [photo("top")] },
    });
    expect(none.statusCode).toBe(503);
    const own = await a.inject({
      method: "POST",
      url: "/photo/detect",
      headers: { "x-anthropic-api-key": "sk-user" },
      payload: { photos: [photo("top")] },
    });
    expect(own.statusCode).toBe(200);
    expect(seen).toEqual([undefined, "sk-user"]);
  });

  it("rate-limits per client", async () => {
    const a = app({ perHour: 2 });
    const codes = [];
    for (let i = 0; i < 3; i++)
      codes.push(
        (
          await a.inject({
            method: "POST",
            url: "/photo/detect",
            payload: { photos: [photo("top")] },
          })
        ).statusCode,
      );
    expect(codes).toEqual([200, 200, 429]);
  });
});
