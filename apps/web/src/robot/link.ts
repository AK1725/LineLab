import type { FlashTransport } from "./stk500";
import type {
  BluetoothLike,
  GattCharacteristicLike,
  SerialLike,
  SerialPortLike,
} from "./web-serial";

/** A byte stream to and from the robot: USB serial or a BLE UART. */
export interface RobotLink {
  readonly kind: "serial" | "ble";
  readonly label: string;
  /** Bytes from the robot. */
  onBytes: (b: Uint8Array) => void;
  onClose: (reason?: string) => void;
  write(b: Uint8Array): Promise<void>;
  close(): Promise<void>;
  /**
   * Serial only: talk to the bootloader. Reopens the port at the bootloader's baud, pauses
   * telemetry, runs `fn`, then returns to the telemetry baud.
   */
  withBootloader?<T>(baud: number, fn: (t: FlashTransport) => Promise<T>): Promise<T>;
}

export const serialApi = (): SerialLike | undefined =>
  (navigator as Navigator & { serial?: SerialLike }).serial;
export const bluetoothApi = (): BluetoothLike | undefined =>
  (navigator as Navigator & { bluetooth?: BluetoothLike }).bluetooth;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Open a USB serial port the user picks (must be called from a click). */
export async function openSerial(baudRate: number): Promise<RobotLink> {
  const api = serialApi();
  if (!api) throw new Error("This browser has no Web Serial. Use Chrome or Edge on a desktop.");
  const port = await api.requestPort();
  await port.open({ baudRate, bufferSize: 64 * 1024 });
  return new SerialLink(port, baudRate);
}

class SerialLink implements RobotLink {
  readonly kind = "serial";
  readonly label: string;
  /** Bytes that arrived before anyone listened (the sketch's hello frame right after open). */
  private early: Uint8Array[] = [];
  private handler: ((b: Uint8Array) => void) | undefined;
  get onBytes(): (b: Uint8Array) => void {
    return (b) => {
      if (this.handler) this.handler(b);
      else if (this.early.length < 256) this.early.push(b);
    };
  }
  set onBytes(fn: (b: Uint8Array) => void) {
    this.handler = fn;
    for (const b of this.early.splice(0)) fn(b);
  }
  onClose: (reason?: string) => void = () => undefined;
  private reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  private closed = false;
  /** While flashing, incoming bytes go here instead of to the telemetry decoder. */
  private flashQueue: number[] | undefined;
  private wake: (() => void) | undefined;

  private pumping: Promise<void> | undefined;

  constructor(
    private readonly port: SerialPortLike,
    private baud: number,
  ) {
    const info = port.getInfo?.();
    const id = info?.usbVendorId
      ? ` ${info.usbVendorId.toString(16).padStart(4, "0")}:${(info.usbProductId ?? 0).toString(16).padStart(4, "0")}`
      : "";
    this.label = `USB serial${id} @ ${baud}`;
    this.pumping = this.pump();
  }

  private reopening = false;

  private async pump() {
    try {
      while (!this.closed && !this.reopening && this.port.readable) {
        this.reader = this.port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await this.reader.read();
            if (done) break;
            if (this.flashQueue) {
              this.flashQueue.push(...value);
              this.wake?.();
            } else this.onBytes(value);
          }
        } finally {
          this.reader.releaseLock();
        }
      }
      if (!this.closed && !this.reopening) this.onClose("The port closed.");
    } catch (e) {
      if (!this.closed && !this.reopening) this.onClose(e instanceof Error ? e.message : String(e));
    }
  }

  /** Close and reopen the same port (no picker) at another baud. */
  private async reopen(baud: number) {
    this.reopening = true;
    try {
      await this.reader?.cancel();
    } catch {
      // already released
    }
    await this.pumping;
    await this.port.close().catch(() => undefined);
    await this.port.open({ baudRate: baud, bufferSize: 64 * 1024 });
    this.baud = baud;
    this.reopening = false;
    this.pumping = this.pump();
  }

  async write(b: Uint8Array) {
    const w = this.port.writable?.getWriter();
    if (!w) throw new Error("The port is not writable.");
    try {
      await w.write(b);
    } finally {
      w.releaseLock();
    }
  }

  async close() {
    this.closed = true;
    try {
      await this.reader?.cancel();
    } catch {
      // already gone
    }
    await this.port.close().catch(() => undefined);
  }

  async withBootloader<T>(baud: number, fn: (t: FlashTransport) => Promise<T>): Promise<T> {
    const telemetryBaud = this.baud;
    const q: number[] = [];
    this.flashQueue = q;
    try {
      if (baud !== telemetryBaud) await this.reopen(baud);
      return await fn(this.transport(q));
    } finally {
      this.flashQueue = undefined;
      if (this.baud !== telemetryBaud && !this.closed) await this.reopen(telemetryBaud);
    }
  }

  private transport(q: number[]): FlashTransport {
    const read = async (n: number, timeoutMs: number) => {
      const until = Date.now() + timeoutMs;
      while (q.length < n) {
        const left = until - Date.now();
        if (left <= 0) throw new Error("timeout");
        await new Promise<void>((r) => {
          this.wake = r;
          setTimeout(r, left);
        });
      }
      return Uint8Array.from(q.splice(0, n));
    };
    return {
      write: (b) => this.write(b),
      read,
      flush: () => {
        q.length = 0;
        return Promise.resolve();
      },
      resetPulse: async () => {
        // Same as avrdude's arduino programmer: DTR/RTS low, then high; the board's 100 nF
        // auto-reset capacitor turns the edge into a reset pulse.
        await this.port.setSignals({ dataTerminalReady: false, requestToSend: false });
        await sleep(250);
        await this.port.setSignals({ dataTerminalReady: true, requestToSend: true });
        await sleep(50);
      },
    };
  }
}

/** BLE UART services LineLab knows: Nordic UART (ESP32, nRF, many modules) and HM-10/CC254x. */
export const BLE_UARTS = [
  {
    name: "Nordic UART",
    service: "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
    notify: "6e400003-b5a3-f393-e0a9-e50e24dcca9e",
    write: "6e400002-b5a3-f393-e0a9-e50e24dcca9e",
  },
  {
    name: "HM-10",
    service: "0000ffe0-0000-1000-8000-00805f9b34fb",
    notify: "0000ffe1-0000-1000-8000-00805f9b34fb",
    write: "0000ffe1-0000-1000-8000-00805f9b34fb",
  },
] as const;

/** Connect to a BLE UART module the user picks (must be called from a click). */
export async function openBle(): Promise<RobotLink> {
  const api = bluetoothApi();
  if (!api) throw new Error("This browser has no Web Bluetooth. Use Chrome or Edge.");
  const device = await api.requestDevice({
    filters: BLE_UARTS.map((u) => ({ services: [u.service] })),
    optionalServices: BLE_UARTS.map((u) => u.service),
  });
  const gatt = device.gatt;
  if (!gatt) throw new Error("This device has no GATT server.");
  const server = await gatt.connect();
  let found:
    { name: string; notify: GattCharacteristicLike; write: GattCharacteristicLike } | undefined;
  for (const u of BLE_UARTS) {
    try {
      const svc = await server.getPrimaryService(u.service);
      found = {
        name: u.name,
        notify: await svc.getCharacteristic(u.notify),
        write: await svc.getCharacteristic(u.write),
      };
      break;
    } catch {
      // not this one
    }
  }
  if (!found) {
    gatt.disconnect();
    throw new Error("No Nordic UART or HM-10 service on this device.");
  }
  const { notify, write, name } = found;
  const link: RobotLink = {
    kind: "ble",
    label: `${device.name ?? "BLE device"} (${name})`,
    onBytes: () => undefined,
    onClose: () => undefined,
    write: async (b) => {
      // BLE packets carry 20 bytes unless the MTU was raised.
      for (let i = 0; i < b.length; i += 20) {
        const chunk = b.slice(i, i + 20);
        if (write.writeValueWithoutResponse) await write.writeValueWithoutResponse(chunk);
        else await write.writeValue(chunk);
      }
    },
    close: () => {
      gatt.disconnect();
      return Promise.resolve();
    },
  };
  notify.addEventListener("characteristicvaluechanged", () => {
    const v = notify.value;
    if (v) link.onBytes(new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)));
  });
  device.addEventListener("gattserverdisconnected", () => {
    link.onClose("The Bluetooth device disconnected.");
  });
  await notify.startNotifications();
  return link;
}
