import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  ClaudeVisionDetector,
  VisionError,
  toDetectionResult,
  visionConfigFromEnv,
} from "./claude.js";

function fakeClient(reply: { stop_reason: string; text: string }) {
  const calls: unknown[] = [];
  const client = {
    messages: {
      stream: (params: unknown) => {
        calls.push(params);
        return {
          finalMessage: () =>
            Promise.resolve({
              model: "claude-opus-5-5",
              stop_reason: reply.stop_reason,
              content: [{ type: "text", text: reply.text }],
            }),
        };
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

const answer = {
  frontInTop: "up",
  notes: ["wires hide part of the driver"],
  detections: [
    {
      category: "motor_driver",
      description: "purple carrier with TB6612FNG",
      markings: ["TB6612FNG"],
      count: 1,
      topBox: { x: 0.4, y: 0.5, w: 0.1, h: 1.3 },
      confidence: 1.2,
    },
    {
      category: "motor",
      description: "N20 gearmotor",
      markings: [],
      count: 2.4,
      topBox: null,
      confidence: 0.7,
    },
  ],
};

describe("Claude vision detector", () => {
  const cfg = visionConfigFromEnv({});
  const photos = [
    { view: "top" as const, mediaType: "image/jpeg" as const, data: "AAAA" },
    { view: "bottom" as const, mediaType: "image/png" as const, data: "BBBB" },
  ];

  it("sends every photo with its view, a JSON schema, adaptive thinking and the configured model", async () => {
    const { client, calls } = fakeClient({ stop_reason: "end_turn", text: JSON.stringify(answer) });
    const r = await new ClaudeVisionDetector(client, cfg).detect(photos);
    const req = calls[0] as {
      model: string;
      thinking: unknown;
      output_config: { format: { type: string }; effort: string };
      messages: { content: { type: string; text?: string; source?: { media_type: string } }[] }[];
    };
    expect(req.model).toBe("claude-opus-5-5");
    expect(req.thinking).toEqual({ type: "adaptive" });
    expect(req.output_config.format.type).toBe("json_schema");
    const content = req.messages[0]?.content ?? [];
    expect(content.filter((b) => b.type === "image").map((b) => b.source?.media_type)).toEqual([
      "image/jpeg",
      "image/png",
    ]);
    expect(content.map((b) => b.text).filter(Boolean)).toContain("Photo 2: bottom view.");
    // Validated and clamped.
    expect(r.detector).toBe("claude-vision");
    expect(r.detections[0]).toMatchObject({ id: "d1", confidence: 1, topBox: { h: 1 } });
    expect(r.detections[1]).toMatchObject({ count: 2 });
    expect(r.detections[1]?.topBox).toBeUndefined();
  });

  it("reports a refusal, a truncated answer and invalid JSON as errors, never as detections", async () => {
    for (const [stop, text, kind] of [
      ["refusal", "", "refusal"],
      ["max_tokens", "{", "truncated"],
      ["end_turn", '{"detections": "nope"}', "invalid"],
    ] as const) {
      const { client } = fakeClient({ stop_reason: stop, text });
      const err = await new ClaudeVisionDetector(client, cfg)
        .detect(photos)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(VisionError);
      expect((err as VisionError).kind).toBe(kind);
    }
  });

  it("rejects an unknown category", () => {
    expect(() =>
      toDetectionResult(
        { ...answer, detections: [{ ...answer.detections[0], category: "robot" }] },
        "m",
      ),
    ).toThrow();
  });

  it("takes model and effort from the environment", () => {
    expect(
      visionConfigFromEnv({ LINELAB_VISION_MODEL: "x", LINELAB_VISION_EFFORT: "high" }),
    ).toMatchObject({
      model: "x",
      effort: "high",
    });
  });
});
