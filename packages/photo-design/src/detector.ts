import type { DetectionResult, PhotoView } from "@linelab/schema";

export interface PhotoInput {
  view: PhotoView;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  /** Base64 image data (no data: prefix). */
  data: string;
}

/**
 * Finds the parts on a robot in its photos. Implementations: Claude vision (the bootstrap,
 * BLUEPRINT §5.10), a trained detector (YOLO) once a labelled dataset exists, and a scripted
 * replay for tests and demos.
 */
export interface PhotoDetector {
  readonly name: DetectionResult["detector"];
  detect(photos: PhotoInput[], signal?: AbortSignal): Promise<DetectionResult>;
}

/** Replays a fixed result (tests, demos). Always reports itself as "scripted". */
export class ScriptedDetector implements PhotoDetector {
  readonly name = "scripted" as const;
  constructor(private readonly result: Omit<DetectionResult, "detector">) {}
  detect(): Promise<DetectionResult> {
    return Promise.resolve({ ...this.result, detector: "scripted" });
  }
}
