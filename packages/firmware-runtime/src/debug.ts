import type { FirmwareSymbol, LineEntry, ValueType } from "@linelab/schema";

/** Maps program addresses (bytes) to source lines using the DWARF line table. */
export class LineMap {
  private readonly rows: LineEntry[];
  constructor(lines: readonly LineEntry[]) {
    this.rows = [...lines].sort((a, b) => a.address - b.address);
  }
  /** The source line for a byte address (the last row at or before it). */
  lookup(address: number): LineEntry | undefined {
    let lo = 0;
    let hi = this.rows.length - 1;
    let best: LineEntry | undefined;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = this.rows[mid];
      if (!r) break;
      if (r.address <= address) {
        best = r;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return best;
  }
}

export type WatchType = ValueType;

/** A sensible default type for a global of this size (4-byte PID state is usually float). */
export const defaultWatchType = (size: number): WatchType =>
  size === 1 ? "u8" : size === 2 ? "i16" : "float";

export function decode(bytes: Uint8Array, type: WatchType): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  switch (type) {
    case "u8":
      return v.getUint8(0);
    case "i8":
      return v.getInt8(0);
    case "u16":
      return v.getUint16(0, true);
    case "i16":
      return v.getInt16(0, true);
    case "u32":
      return v.getUint32(0, true);
    case "i32":
      return v.getInt32(0, true);
    case "float":
      return v.getFloat32(0, true);
    case "bool":
      return v.getUint8(0) ? 1 : 0;
  }
}

/** Globals worth watching: sized data/bss variables from the sketch, not the Arduino core's. */
export function watchableSymbols(symbols: readonly FirmwareSymbol[]): FirmwareSymbol[] {
  const core = /^(Serial|timer0_|__|_|vtable|typeinfo|guard)/;
  return symbols.filter(
    (s) =>
      s.kind !== "function" &&
      s.size >= 1 &&
      s.size <= 4 &&
      !core.test(s.name) &&
      !s.name.includes("::"),
  );
}

/** Summary of control-loop periods (ms) from successive sample timestamps (ms). */
export function periodStats(stampsMs: readonly number[]) {
  const periods: number[] = [];
  for (let i = 1; i < stampsMs.length; i++)
    periods.push((stampsMs[i] ?? 0) - (stampsMs[i - 1] ?? 0));
  if (periods.length === 0) return undefined;
  const sorted = [...periods].sort((a, b) => a - b);
  const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))] ?? 0;
  const mean = periods.reduce((a, b) => a + b, 0) / periods.length;
  return {
    count: periods.length,
    meanMs: mean,
    p5Ms: q(0.05),
    medianMs: q(0.5),
    p95Ms: q(0.95),
    maxMs: sorted.at(-1) ?? 0,
  };
}
