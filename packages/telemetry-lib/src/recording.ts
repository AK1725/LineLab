import type { TelemetryRecording, TelemetrySampleRecord } from "@linelab/schema";
import { FrameDecoder, type TelemetryFrame } from "./protocol.js";

const WRAP_MS = 2 ** 32 / 1000;

/**
 * Builds a TelemetryRecording from frames as they arrive. Unwraps the robot's 32-bit micros()
 * clock (it wraps every ~71.6 min) so `tMs` keeps increasing.
 */
export class RecordingBuilder {
  private name = "unknown";
  private sensorCount = 0;
  private periodMs = 10;
  private lastRawMs: number | undefined;
  private wraps = 0;
  readonly samples: TelemetrySampleRecord[] = [];
  readonly notes: string[] = [];

  constructor(private readonly source: TelemetryRecording["source"]) {}

  add(f: TelemetryFrame): TelemetrySampleRecord | undefined {
    if (f.type === "hello") {
      this.name = f.name || "unknown";
      this.sensorCount = f.sensorCount;
      this.periodMs = f.periodMs || 10;
      return undefined;
    }
    if (f.type === "text") {
      if (this.notes.length < 1000) this.notes.push(f.text);
      return undefined;
    }
    const raw = f.tUs / 1000;
    if (this.lastRawMs !== undefined && raw + WRAP_MS / 2 < this.lastRawMs) this.wraps++;
    this.lastRawMs = raw;
    const s: TelemetrySampleRecord = {
      tMs: raw + this.wraps * WRAP_MS,
      sensors: f.sensors,
      pwmLeft: Math.max(-1, Math.min(1, f.pwmLeft)),
      pwmRight: Math.max(-1, Math.min(1, f.pwmRight)),
      lineLost: f.lineLost,
      vars: f.vars,
      ...(f.batteryV !== undefined ? { batteryV: f.batteryV } : {}),
      ...(f.encoders ? { encoders: f.encoders } : {}),
    };
    if (!this.sensorCount) this.sensorCount = f.sensors.length;
    this.samples.push(s);
    return s;
  }

  build(extra: Pick<TelemetryRecording, "trackId" | "startPose"> = {}): TelemetryRecording {
    return {
      format: "linelab-telemetry/1",
      name: this.name,
      source: this.source,
      sensorCount: this.sensorCount,
      periodMs: this.periodMs,
      ...(extra.trackId !== undefined ? { trackId: extra.trackId } : {}),
      ...(extra.startPose !== undefined ? { startPose: extra.startPose } : {}),
      notes: [...this.notes],
      samples: [...this.samples],
    };
  }
}

/** Decode a whole byte stream (e.g. a captured serial log) into a recording. */
export function decodeRecording(
  bytes: ArrayLike<number>,
  source: TelemetryRecording["source"],
): { recording: TelemetryRecording; badFrames: number; skippedBytes: number } {
  const d = new FrameDecoder();
  const b = new RecordingBuilder(source);
  for (const f of d.push(bytes)) b.add(f);
  return { recording: b.build(), badFrames: d.badFrames, skippedBytes: d.skippedBytes };
}

/** Bytes of a serial log captured as a string of char codes 0..255 (the emulator's format). */
export const bytesOfLatin1 = (s: string): Uint8Array =>
  Uint8Array.from({ length: s.length }, (_, i) => s.charCodeAt(i) & 0xff);
