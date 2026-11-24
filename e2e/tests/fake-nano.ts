// Test double for hardware: used by robot.spec.ts via page.addInitScript (serialised, so it must
// be self-contained).
/**
 * A fake navigator.serial: one USB port with an Arduino Nano behind it. After a DTR reset the
 * "board" runs an STK500 bootloader (Optiboot) for a moment, then its sketch, which streams
 * LineLabTelemetry frames every 10 ms. Everything here is the test's stand-in for hardware.
 */
export function installFakeSerial() {
  const crc16 = (bytes: number[], init = 0xffff) => {
    let c = init;
    for (const b of bytes) {
      c ^= b << 8;
      for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
    }
    return c;
  };
  const frame = (type: number, payload: number[]) => {
    const head = [1, type, payload.length];
    const crc = crc16(payload, crc16(head));
    return [0xa5, 0x5a, ...head, ...payload, crc & 0xff, crc >> 8];
  };
  const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
  const u32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
  const f32 = (v: number) => [...new Uint8Array(new Float32Array([v]).buffer)];
  const hello = () => {
    const name = Array.from(new TextEncoder().encode("fake_nano"));
    return frame(2, [1, 8, ...u16(10), name.length, ...name]);
  };
  let t = 0;
  const sample = () => {
    t += 10;
    const pos = Math.sin(t / 300) * 3;
    const sensors = Array.from({ length: 8 }, (_, i) =>
      Math.round(80 + 820 * Math.exp(-(((i - 3.5 - pos) / 1.2) ** 2))),
    );
    const l = Math.round(400 - pos * 80);
    const r = Math.round(400 + pos * 80);
    return frame(1, [
      ...u32(t * 1000),
      8,
      ...sensors.flatMap(u16),
      ...u16(l & 0xffff),
      ...u16(r & 0xffff),
      ...u16(7400),
      0,
      1,
      ...f32(pos * 1000),
    ]);
  };

  const flash = new Uint8Array(32768).fill(0xff);
  let mode: "sketch" | "boot" = "sketch";
  let address = 0;
  let rx: number[] = [];
  let push: ((b: Uint8Array) => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let baud = 0;
  const stats = { programmedBytes: 0, resets: 0, bootBaud: 0, left: false };
  const reply = (data: number[] = []) => push?.(Uint8Array.from([0x14, ...data, 0x10]));
  const startSketch = () => {
    mode = "sketch";
    push?.(Uint8Array.from([...new TextEncoder().encode("boot\r\n"), ...hello()]));
    clearInterval(timer);
    timer = setInterval(() => push?.(Uint8Array.from(sample())), 10);
  };
  const boot = (bytes: Uint8Array) => {
    rx.push(...bytes);
    for (;;) {
      const eop = rx.indexOf(0x20);
      if (eop < 0) return;
      const cmd = rx[0];
      if (cmd === 0x64) {
        const len = ((rx[1] ?? 0) << 8) | (rx[2] ?? 0);
        if (rx.length < len + 5) return;
        flash.set(rx.slice(4, 4 + len), address);
        stats.programmedBytes += len;
        rx.splice(0, len + 5);
        reply();
        continue;
      }
      const f = rx.splice(0, eop + 1);
      if (cmd === 0x30 || cmd === 0x50) reply();
      else if (cmd === 0x75) reply([0x1e, 0x95, 0x0f]);
      else if (cmd === 0x55) {
        address = ((f[1] ?? 0) | ((f[2] ?? 0) << 8)) * 2;
        reply();
      } else if (cmd === 0x74) {
        const len = ((f[1] ?? 0) << 8) | (f[2] ?? 0);
        reply([...flash.subarray(address, address + len)]);
      } else if (cmd === 0x51) {
        reply();
        stats.left = true;
        setTimeout(startSketch, 20);
      }
    }
  };
  let dtr = true;
  const port = {
    readable: null as ReadableStream<Uint8Array> | null,
    writable: null as WritableStream<Uint8Array> | null,
    getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 }),
    open({ baudRate }: { baudRate: number }) {
      baud = baudRate;
      port.readable = new ReadableStream<Uint8Array>({
        start(c) {
          push = (b) => {
            c.enqueue(b);
          };
        },
        cancel() {
          push = undefined;
        },
      });
      port.writable = new WritableStream<Uint8Array>({
        write(chunk) {
          if (mode === "boot") boot(chunk);
        },
      });
      startSketch();
      return Promise.resolve();
    },
    close() {
      clearInterval(timer);
      port.readable = null;
      port.writable = null;
      return Promise.resolve();
    },
    setSignals(s: { dataTerminalReady?: boolean }) {
      if (s.dataTerminalReady === true && !dtr) {
        // DTR edge → reset → bootloader listens (at its own baud).
        stats.resets++;
        stats.bootBaud = baud;
        clearInterval(timer);
        mode = "boot";
        rx = [];
      }
      dtr = s.dataTerminalReady ?? dtr;
      return Promise.resolve();
    },
  };
  Object.defineProperty(navigator, "serial", {
    value: { requestPort: () => Promise.resolve(port) },
  });
  (window as unknown as { __fakeNano: unknown }).__fakeNano = { flash, stats };
}
