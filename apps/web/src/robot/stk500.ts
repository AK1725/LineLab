/**
 * STK500 v1 (the subset Optiboot and the ATmegaBOOT bootloaders speak) for flashing ATmega328P
 * boards — Uno, Nano, Pro Mini — over Web Serial, without a native tool.
 * Protocol: Atmel AVR061 "STK500 Communication Protocol".
 */

export const STK = {
  OK: 0x10,
  INSYNC: 0x14,
  CRC_EOP: 0x20,
  GET_SYNC: 0x30,
  ENTER_PROGMODE: 0x50,
  LEAVE_PROGMODE: 0x51,
  LOAD_ADDRESS: 0x55,
  PROG_PAGE: 0x64,
  READ_PAGE: 0x74,
  READ_SIGN: 0x75,
} as const;

/** ATmega328P: 32 KiB flash, 128-byte pages, 0.5–4 KiB at the top is the bootloader. */
export const ATMEGA328P = {
  signature: [0x1e, 0x95, 0x0f],
  pageBytes: 128,
  flashBytes: 32_768,
} as const;

/** Serial transport the flasher talks through (Web Serial port, or a fake in tests). */
export interface FlashTransport {
  write(bytes: Uint8Array): Promise<void>;
  /** Read exactly n bytes or reject after timeoutMs. */
  read(n: number, timeoutMs: number): Promise<Uint8Array>;
  /** Drop anything buffered (boot noise from the sketch). */
  flush(): Promise<void>;
  /** Pulse DTR/RTS to reset the board into its bootloader (auto-reset circuit). */
  resetPulse(): Promise<void>;
}

export interface FlashProgress {
  phase: "reset" | "sync" | "signature" | "write" | "verify" | "done";
  done: number;
  total: number;
}

export class FlashError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "FlashError";
  }
}

async function command(t: FlashTransport, bytes: number[], replyBytes = 0, timeoutMs = 500) {
  await t.write(Uint8Array.from([...bytes, STK.CRC_EOP]));
  const r = await t.read(replyBytes + 2, timeoutMs);
  if (r[0] !== STK.INSYNC || r[r.length - 1] !== STK.OK)
    throw new FlashError(
      `Bootloader answered ${[...r].map((b) => b.toString(16).padStart(2, "0")).join(" ")} to command 0x${(bytes[0] ?? 0).toString(16)}.`,
    );
  return r.subarray(1, 1 + replyBytes);
}

/** Pages of the image that contain data (unprogrammed 0xFF pages beyond the end are skipped). */
export function pagesOf(
  image: Uint8Array,
  pageBytes: number,
): { address: number; data: Uint8Array }[] {
  let end = image.length;
  while (end > 0 && image[end - 1] === 0xff) end--;
  const pages = [];
  for (let a = 0; a < end; a += pageBytes) {
    const data = new Uint8Array(pageBytes).fill(0xff);
    data.set(image.subarray(a, Math.min(a + pageBytes, end)));
    pages.push({ address: a, data });
  }
  return pages;
}

/**
 * Flash `image` (byte 0 = flash address 0) and verify it by reading it back.
 * Throws FlashError with a hint when the bootloader never answers (wrong baud, no auto-reset).
 */
export async function flashStk500(
  t: FlashTransport,
  image: Uint8Array,
  onProgress: (p: FlashProgress) => void = () => undefined,
  device = ATMEGA328P,
): Promise<{ bytes: number; pages: number }> {
  const pages = pagesOf(image, device.pageBytes);
  const bootStart = device.flashBytes - 512;
  if (pages.length * device.pageBytes > bootStart)
    throw new FlashError(`The sketch is ${image.length} bytes; it would overwrite the bootloader.`);

  onProgress({ phase: "reset", done: 0, total: pages.length });
  await t.resetPulse();
  onProgress({ phase: "sync", done: 0, total: pages.length });
  let synced = false;
  for (let i = 0; i < 12 && !synced; i++) {
    try {
      await t.flush();
      await command(t, [STK.GET_SYNC], 0, 200);
      synced = true;
    } catch {
      // The bootloader only listens for ~1 s after reset; keep knocking.
    }
  }
  if (!synced)
    throw new FlashError(
      "The bootloader didn't answer.",
      "Check the board and baud rate (Uno and new-bootloader Nano: 115200; old-bootloader Nano and Pro Mini: 57600). A Pro Mini on an adapter without DTR needs its reset button pressed just as flashing starts.",
    );
  onProgress({ phase: "signature", done: 0, total: pages.length });
  const sig = await command(t, [STK.READ_SIGN], 3);
  if (![...sig].every((b, i) => b === device.signature[i]))
    throw new FlashError(
      `Unexpected chip signature ${[...sig].map((b) => b.toString(16)).join(" ")} (expected ATmega328P 1e 95 0f).`,
      "LineLab can only flash ATmega328P boards (Uno, Nano, Pro Mini) for now.",
    );
  await command(t, [STK.ENTER_PROGMODE]);
  const load = (address: number) => {
    const word = address >> 1;
    return command(t, [STK.LOAD_ADDRESS, word & 0xff, word >> 8]);
  };
  for (const [i, p] of pages.entries()) {
    await load(p.address);
    await command(
      t,
      [STK.PROG_PAGE, p.data.length >> 8, p.data.length & 0xff, 0x46, ...p.data],
      0,
      1000,
    );
    onProgress({ phase: "write", done: i + 1, total: pages.length });
  }
  for (const [i, p] of pages.entries()) {
    await load(p.address);
    const back = await command(
      t,
      [STK.READ_PAGE, p.data.length >> 8, p.data.length & 0xff, 0x46],
      p.data.length,
      1000,
    );
    const bad = p.data.findIndex((b, k) => back[k] !== b);
    if (bad >= 0)
      throw new FlashError(
        `Verify failed at 0x${(p.address + bad).toString(16)}: wrote ${(p.data[bad] ?? 0).toString(16)}, read ${(back[bad] ?? 0).toString(16)}.`,
      );
    onProgress({ phase: "verify", done: i + 1, total: pages.length });
  }
  await command(t, [STK.LEAVE_PROGMODE]);
  onProgress({ phase: "done", done: pages.length, total: pages.length });
  return { bytes: image.length, pages: pages.length };
}

/**
 * A software Optiboot for tests: answers STK500 commands, programs pages into `flash`, and can be
 * told to ignore everything (a board without auto-reset) or to corrupt a byte (bad flash cell).
 */
export class FakeOptiboot {
  readonly flash = new Uint8Array(ATMEGA328P.flashBytes).fill(0xff);
  private address = 0;
  private rx: number[] = [];
  private tx: number[] = [];
  listening = false;
  left = false;

  constructor(
    private readonly opts: { deaf?: boolean; stuckBit?: number; signature?: number[] } = {},
  ) {}

  reset() {
    this.listening = !this.opts.deaf;
    this.left = false;
    this.rx = [];
  }

  receive(bytes: ArrayLike<number>) {
    if (!this.listening) return;
    for (let i = 0; i < bytes.length; i++) this.rx.push(bytes[i] ?? 0);
    this.process();
  }

  take(): number[] {
    const out = this.tx;
    this.tx = [];
    return out;
  }

  private reply(data: number[] = []) {
    this.tx.push(STK.INSYNC, ...data, STK.OK);
  }

  private process() {
    for (;;) {
      const eop = this.rx.indexOf(STK.CRC_EOP);
      if (eop < 0) return;
      const cmd = this.rx[0];
      // PROG_PAGE carries 0x20 bytes in its data: wait for the whole frame.
      if (cmd === STK.PROG_PAGE) {
        const len = ((this.rx[1] ?? 0) << 8) | (this.rx[2] ?? 0);
        if (this.rx.length < 4 + len + 1) return;
        const data = this.rx.slice(4, 4 + len);
        this.rx.splice(0, 4 + len + 1);
        data.forEach((b, k) => {
          const a = this.address + k;
          this.flash[a] = this.opts.stuckBit === a ? b & 0xfe : b;
        });
        this.reply();
        continue;
      }
      const frame = this.rx.splice(0, eop + 1);
      if (cmd === STK.GET_SYNC || cmd === STK.ENTER_PROGMODE) this.reply();
      else if (cmd === STK.READ_SIGN) this.reply(this.opts.signature ?? [...ATMEGA328P.signature]);
      else if (cmd === STK.LOAD_ADDRESS) {
        this.address = ((frame[1] ?? 0) | ((frame[2] ?? 0) << 8)) * 2;
        this.reply();
      } else if (cmd === STK.READ_PAGE) {
        const len = ((frame[1] ?? 0) << 8) | (frame[2] ?? 0);
        this.reply([...this.flash.subarray(this.address, this.address + len)]);
      } else if (cmd === STK.LEAVE_PROGMODE) {
        this.reply();
        this.left = true;
        this.listening = false;
      } else this.tx.push(0x12); // STK_UNKNOWN
    }
  }
}

/** Transport straight into a FakeOptiboot (unit tests). */
export function fakeTransport(boot: FakeOptiboot): FlashTransport {
  let inbox: number[] = [];
  return {
    write: (b) => {
      boot.receive(b);
      inbox.push(...boot.take());
      return Promise.resolve();
    },
    read: (n) =>
      inbox.length >= n
        ? Promise.resolve(Uint8Array.from(inbox.splice(0, n)))
        : Promise.reject(new Error("timeout")),
    flush: () => {
      inbox = [];
      return Promise.resolve();
    },
    resetPulse: () => {
      boot.reset();
      return Promise.resolve();
    },
  };
}

/** End address (exclusive) of the data in an Intel HEX file: how many bytes to flash. */
export function hexExtent(hex: string): number {
  let base = 0;
  let end = 0;
  for (const raw of hex.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith(":") || line.length < 11) continue;
    const len = parseInt(line.slice(1, 3), 16);
    const addr = parseInt(line.slice(3, 7), 16);
    const type = parseInt(line.slice(7, 9), 16);
    if (type === 0x00) end = Math.max(end, base + addr + len);
    else if (type === 0x02) base = parseInt(line.slice(9, 13), 16) * 16;
    else if (type === 0x04) base = parseInt(line.slice(9, 13), 16) * 65536;
  }
  return end;
}
