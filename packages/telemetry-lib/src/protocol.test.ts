import { describe, expect, it } from "vitest";
import { FrameDecoder, crc16, encodeFrame, type TelemetrySample } from "./protocol.js";
import { RecordingBuilder, bytesOfLatin1, decodeRecording } from "./recording.js";

const sample = (over: Partial<TelemetrySample> = {}): TelemetrySample => ({
  type: "sample",
  tUs: 123_456,
  sensors: [10, 200, 900, 1023, 512, 0, 4, 77],
  pwmLeft: 0.451,
  pwmRight: -0.25,
  batteryV: 7.42,
  lineLost: false,
  encoders: [1234, -56],
  vars: [1.5, -3500],
  ...over,
});

describe("crc16", () => {
  it("matches the CRC-16/CCITT-FALSE check value", () => {
    expect(crc16(new TextEncoder().encode("123456789"))).toBe(0x29b1);
  });
});

describe("FrameDecoder", () => {
  it("round-trips sample, hello and text frames", () => {
    const frames = [
      sample(),
      sample({ encoders: undefined, batteryV: undefined, vars: [], lineLost: true }),
      { type: "hello", version: 1, sensorCount: 8, periodMs: 10, name: "robot" } as const,
      { type: "text", text: "calibrated" } as const,
    ];
    const d = new FrameDecoder();
    const out = d.push(Uint8Array.from(frames.flatMap((f) => [...encodeFrame(f)])));
    expect(out).toEqual(frames);
    expect(d.badFrames).toBe(0);
  });

  it("reassembles frames split across arbitrary chunks and skips text between them", () => {
    const bytes = [
      ...new TextEncoder().encode("boot ok\r\n"),
      ...encodeFrame(sample()),
      ...new TextEncoder().encode("err 12\n"),
      ...encodeFrame(sample({ tUs: 133_456 })),
    ];
    const d = new FrameDecoder();
    const out = [];
    for (let i = 0; i < bytes.length; i += 3) out.push(...d.push(bytes.slice(i, i + 3)));
    expect(out.map((f) => (f.type === "sample" ? f.tUs : -1))).toEqual([123_456, 133_456]);
    expect(d.skippedBytes).toBe(9 + 7);
  });

  it("drops a frame with a corrupted byte and recovers on the next one", () => {
    const bad = encodeFrame(sample());
    bad[10] = (bad[10] ?? 0) ^ 0x40;
    const d = new FrameDecoder();
    const out = d.push([...bad, ...encodeFrame(sample({ tUs: 9 }))]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ tUs: 9 });
    expect(d.badFrames).toBeGreaterThanOrEqual(1);
  });

  it("does not emit anything for a lone sync pair or a truncated frame", () => {
    const d = new FrameDecoder();
    expect(d.push([0xa5, 0x5a, 1, 1])).toEqual([]);
    expect(d.push(encodeFrame(sample()).subarray(0, 10))).toEqual([]);
  });
});

describe("RecordingBuilder", () => {
  it("takes name and period from the hello frame and unwraps micros() overflow", () => {
    const b = new RecordingBuilder("synthetic");
    b.add({ type: "hello", version: 1, sensorCount: 8, periodMs: 20, name: "bot" });
    b.add(sample({ tUs: 2 ** 32 - 10_000 }));
    b.add(sample({ tUs: 10_000 }));
    const r = b.build();
    expect(r).toMatchObject({ name: "bot", periodMs: 20, sensorCount: 8, source: "synthetic" });
    const [a, c] = r.samples;
    expect((c?.tMs ?? 0) - (a?.tMs ?? 0)).toBeCloseTo(20, 6);
  });

  it("decodes a latin1 serial capture", () => {
    const s = String.fromCharCode(...encodeFrame(sample()));
    const { recording } = decodeRecording(bytesOfLatin1(`hi\n${s}`), "simulated");
    expect(recording.samples).toHaveLength(1);
    expect(recording.samples[0]?.encoders).toEqual([1234, -56]);
  });
});
