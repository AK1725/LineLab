// The WebAssembly JS API is in lib.dom/lib.webworker, which this package (shared by Node and
// workers) doesn't include. Declare the part the HAL host uses.
declare namespace WebAssembly {
  class Module {
    constructor(bytes: Uint8Array);
    readonly __brand: "WebAssembly.Module";
  }
  class Instance {
    constructor(module: Module, imports: Record<string, Record<string, unknown>>);
    readonly exports: Record<string, unknown>;
  }
  class Memory {
    readonly buffer: ArrayBuffer;
  }
}
