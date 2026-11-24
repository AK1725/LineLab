// Minimal typings for the parts of Web Serial and Web Bluetooth LineLab uses (not yet in
// TypeScript's DOM lib). https://wicg.github.io/serial/ · https://webbluetoothcg.github.io/web-bluetooth/
export interface SerialPortLike {
  open(o: { baudRate: number; bufferSize?: number }): Promise<void>;
  close(): Promise<void>;
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  setSignals(s: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>;
  getInfo?(): { usbVendorId?: number; usbProductId?: number };
}

export interface SerialLike {
  requestPort(o?: { filters?: { usbVendorId?: number }[] }): Promise<SerialPortLike>;
}

export interface GattCharacteristicLike extends EventTarget {
  readonly value: DataView | null;
  readonly properties: { notify: boolean; write: boolean; writeWithoutResponse: boolean };
  startNotifications(): Promise<GattCharacteristicLike>;
  writeValueWithoutResponse?(v: BufferSource): Promise<void>;
  writeValue(v: BufferSource): Promise<void>;
}

export interface BluetoothDeviceLike extends EventTarget {
  readonly name?: string;
  readonly gatt?: {
    connect(): Promise<{
      getPrimaryService(uuid: string): Promise<{
        getCharacteristic(uuid: string): Promise<GattCharacteristicLike>;
      }>;
    }>;
    disconnect(): void;
    readonly connected: boolean;
  };
}

export interface BluetoothLike {
  requestDevice(o: {
    filters?: { services?: string[]; namePrefix?: string }[];
    optionalServices?: string[];
    acceptAllDevices?: boolean;
  }): Promise<BluetoothDeviceLike>;
}
