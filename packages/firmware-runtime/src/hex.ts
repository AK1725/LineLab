/** Parse Intel HEX into a flash image (bytes). Throws on a malformed line or checksum. */
export function parseIntelHex(text: string, flashBytes = 32 * 1024): Uint8Array {
  const flash = new Uint8Array(flashBytes);
  let base = 0;
  for (const [n, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (line === "") continue;
    if (!line.startsWith(":")) throw new Error(`HEX line ${n + 1}: missing ':'`);
    const bytes = Uint8Array.from(line.slice(1).match(/../g) ?? [], (h) => Number.parseInt(h, 16));
    const len = bytes[0] ?? 0;
    if (bytes.length !== len + 5) throw new Error(`HEX line ${n + 1}: wrong length`);
    if (bytes.reduce((s, b) => (s + b) & 0xff, 0) !== 0)
      throw new Error(`HEX line ${n + 1}: bad checksum`);
    const addr = ((bytes[1] ?? 0) << 8) | (bytes[2] ?? 0);
    const type = bytes[3];
    if (type === 0) {
      const at = base + addr;
      if (at + len > flash.length) throw new Error(`HEX line ${n + 1}: data past the end of flash`);
      flash.set(bytes.subarray(4, 4 + len), at);
    } else if (type === 1) break;
    else if (type === 2) base = (((bytes[4] ?? 0) << 8) | (bytes[5] ?? 0)) << 4;
    else if (type === 4) base = (((bytes[4] ?? 0) << 8) | (bytes[5] ?? 0)) << 16;
  }
  return flash;
}
