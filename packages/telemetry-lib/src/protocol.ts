/**
 * The LineLabTelemetry wire protocol (see arduino/LineLabTelemetry). Little-endian frames:
 *   A5 5A | version | type | length | payload | CRC-16/CCITT-FALSE (over version..payload)
 */
export const SYNC = [0xa5, 0x5a] as const;
export const PROTOCOL_VERSION = 1;

export interface TelemetrySample {
  type: "sample";
  /** micros() on the robot. */
  tUs: number;
  sensors: number[];
  /** Signed motor commands, −1..1. */
  pwmLeft: number;
  pwmRight: number;
  /** undefined when not reported. */
  batteryV: number | undefined;
  lineLost: boolean;
  encoders: [number, number] | undefined;
  vars: number[];
}
export interface TelemetryHello {
  type: "hello";
  version: number;
  sensorCount: number;
  periodMs: number;
  name: string;
}
export interface TelemetryText {
  type: "text";
  text: string;
}
export type TelemetryFrame = TelemetrySample | TelemetryHello | TelemetryText;

export function crc16(bytes: ArrayLike<number>, crc = 0xffff): number {
  let c = crc;
  for (let i = 0; i < bytes.length; i++) {
    c ^= (bytes[i] ?? 0) << 8;
    for (let b = 0; b < 8; b++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
  }
  return c;
}

function payloadOf(f: TelemetryFrame): { type: number; payload: Uint8Array } {
  if (f.type === "text")
    return { type: 3, payload: new TextEncoder().encode(f.text).slice(0, 200) };
  if (f.type === "hello") {
    const name = new TextEncoder().encode(f.name).slice(0, 32);
    const p = new Uint8Array(5 + name.length);
    const v = new DataView(p.buffer);
    p[0] = f.version;
    p[1] = f.sensorCount;
    v.setUint16(2, f.periodMs, true);
    p[4] = name.length;
    p.set(name, 5);
    return { type: 2, payload: p };
  }
  const n = f.sensors.length;
  const len = 4 + 1 + 2 * n + 6 + 1 + (f.encoders ? 8 : 0) + 1 + 4 * f.vars.length;
  const p = new Uint8Array(len);
  const v = new DataView(p.buffer);
  let o = 0;
  v.setUint32(o, f.tUs >>> 0, true);
  o += 4;
  p[o++] = n;
  for (const s of f.sensors) {
    v.setUint16(o, s, true);
    o += 2;
  }
  v.setInt16(o, Math.round(f.pwmLeft * 1000), true);
  v.setInt16(o + 2, Math.round(f.pwmRight * 1000), true);
  v.setUint16(o + 4, f.batteryV === undefined ? 0 : Math.round(f.batteryV * 1000), true);
  o += 6;
  p[o++] = (f.lineLost ? 1 : 0) | (f.encoders ? 2 : 0);
  if (f.encoders) {
    v.setInt32(o, f.encoders[0], true);
    v.setInt32(o + 4, f.encoders[1], true);
    o += 8;
  }
  p[o++] = f.vars.length;
  for (const x of f.vars) {
    v.setFloat32(o, x, true);
    o += 4;
  }
  return { type: 1, payload: p };
}

/** Encode a frame (used by tests, the simulator's virtual robot and the fake ports in e2e). */
export function encodeFrame(f: TelemetryFrame): Uint8Array {
  const { type, payload } = payloadOf(f);
  const head = [PROTOCOL_VERSION, type, payload.length];
  const crc = crc16(payload, crc16(head));
  return Uint8Array.from([...SYNC, ...head, ...payload, crc & 0xff, crc >> 8]);
}

function decodePayload(type: number, p: Uint8Array): TelemetryFrame | undefined {
  const v = new DataView(p.buffer, p.byteOffset, p.byteLength);
  try {
    if (type === 3) return { type: "text", text: new TextDecoder().decode(p) };
    if (type === 2)
      return {
        type: "hello",
        version: p[0] ?? 0,
        sensorCount: p[1] ?? 0,
        periodMs: v.getUint16(2, true),
        name: new TextDecoder().decode(p.subarray(5, 5 + (p[4] ?? 0))),
      };
    if (type !== 1) return undefined;
    let o = 0;
    const tUs = v.getUint32(o, true);
    o += 4;
    const n = p[o++] ?? 0;
    const sensors: number[] = [];
    for (let i = 0; i < n; i++, o += 2) sensors.push(v.getUint16(o, true));
    const pwmLeft = v.getInt16(o, true) / 1000;
    const pwmRight = v.getInt16(o + 2, true) / 1000;
    const mv = v.getUint16(o + 4, true);
    o += 6;
    const flags = p[o++] ?? 0;
    let encoders: [number, number] | undefined;
    if (flags & 2) {
      encoders = [v.getInt32(o, true), v.getInt32(o + 4, true)];
      o += 8;
    }
    const nv = p[o++] ?? 0;
    const vars: number[] = [];
    for (let i = 0; i < nv; i++, o += 4) vars.push(v.getFloat32(o, true));
    if (o !== p.length) return undefined;
    return {
      type: "sample",
      tUs,
      sensors,
      pwmLeft,
      pwmRight,
      batteryV: mv ? mv / 1000 : undefined,
      lineLost: (flags & 1) !== 0,
      encoders,
      vars,
    };
  } catch {
    return undefined;
  }
}

/**
 * Streaming decoder: push bytes as they arrive (any chunking); complete, CRC-checked frames come
 * out. Garbage between frames (boot messages, Serial.print text) is skipped and counted.
 */
export class FrameDecoder {
  private buf: number[] = [];
  /** Frames dropped for a bad CRC or a malformed payload. */
  badFrames = 0;
  /** Bytes skipped while looking for a frame start. */
  skippedBytes = 0;

  push(chunk: ArrayLike<number>): TelemetryFrame[] {
    for (let i = 0; i < chunk.length; i++) this.buf.push((chunk[i] ?? 0) & 0xff);
    const out: TelemetryFrame[] = [];
    for (;;) {
      let s = 0;
      while (s + 1 < this.buf.length && !(this.buf[s] === SYNC[0] && this.buf[s + 1] === SYNC[1]))
        s++;
      if (s > 0) {
        this.skippedBytes += s;
        this.buf.splice(0, s);
      }
      if (this.buf.length < 7) break;
      const len = this.buf[4] ?? 0;
      const total = 5 + len + 2;
      if (this.buf.length < total) break;
      const head = this.buf.slice(2, 5);
      const payload = Uint8Array.from(this.buf.slice(5, 5 + len));
      const crc = (this.buf[5 + len] ?? 0) | ((this.buf[6 + len] ?? 0) << 8);
      const ok = head[0] === PROTOCOL_VERSION && crc16(payload, crc16(head)) === crc;
      const frame = ok ? decodePayload(head[1] ?? 0, payload) : undefined;
      if (frame) {
        out.push(frame);
        this.buf.splice(0, total);
      } else {
        // Not a frame after all: skip this sync byte and look again.
        this.badFrames++;
        this.buf.splice(0, 1);
      }
    }
    return out;
  }
}
