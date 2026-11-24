import {
  Prng,
  type Controller,
  type ControllerInput,
  type MotorCommand,
  type SimResult,
  type Simulation,
} from "@linelab/sim-core";
import type { FirmwareArtifact } from "@linelab/schema";
import { halPinNumber } from "./boards.js";
import { periodStats } from "./debug.js";
import { motorCommand, type FirmwareWiring } from "./wiring.js";

/**
 * Simulated cost of each HAL call (µs). The HAL tier has no CPU model, so time only moves when the
 * sketch calls into the core; these figures are typical for a 160–240 MHz MCU running the Arduino
 * core. Results are approximate and the UI says so.
 */
export const HAL_COST_US = {
  loop: 2,
  pinMode: 0.5,
  digitalWrite: 0.3,
  digitalRead: 0.3,
  analogRead: 10,
  analogWrite: 1,
  serialByte: 0,
} as const;

/** Thrown inside an import to unwind out of WebAssembly. */
class Unwind extends Error {
  constructor(readonly why: "done" | "reset") {
    super(why);
  }
}

/** The robot side of a HAL sketch: the simulator calls tick() each ms and gets the pins' state. */
class HalController implements Controller {
  readonly name = "firmware-hal";
  latest: ControllerInput | undefined;
  readonly levels = new Map<string, number>();
  resetRequested = false;
  constructor(private readonly wiring: FirmwareWiring) {}
  reset(): void {
    this.resetRequested = true;
  }
  tick(input: ControllerInput): MotorCommand {
    this.latest = input;
    return motorCommand(this.wiring, (pin) => this.levels.get(pin));
  }
}

interface Exports {
  memory: WebAssembly.Memory;
  setup: () => void;
  loop: () => void;
  hal_init: () => void;
}

/**
 * Run a sketch compiled against @linelab/lfr-hal (WebAssembly) on a simulation. The sketch drives
 * time: delay() and every HAL call advance the clock, and the simulator steps each time a
 * millisecond boundary passes.
 */
export class HalRunner {
  serial = "";
  resets = 0;
  private readonly controller: HalController;
  private readonly pinIdOf = new Map<number, string>();
  private readonly sensorOfPin = new Map<string, number>();
  private readonly modes = new Map<string, number>();
  private readonly released = new Map<string, number>();
  private tUs = 0;
  private readonly rng: Prng;
  private readonly sampleStampsMs: number[] = [];
  private readonly firstSensorPin: string | undefined;
  private readonly module: WebAssembly.Module;

  constructor(
    private readonly sim: Simulation,
    artifact: FirmwareArtifact,
    wiring: FirmwareWiring,
    /** Called after every simulated millisecond (e.g. a heartbeat). */
    private readonly onStep?: (simMs: number) => void,
  ) {
    if (artifact.tier !== "hal" || !artifact.wasmBase64)
      throw new Error("HalRunner needs HAL (WebAssembly) firmware.");
    if (!(sim.controller instanceof HalController))
      throw new Error("Create the Simulation with HalRunner.controllerFor(wiring).");
    this.controller = sim.controller;
    for (const p of wiring.mcu.pins) {
      const n = halPinNumber(p.id);
      if (n !== undefined && !this.pinIdOf.has(n)) this.pinIdOf.set(n, p.id);
    }
    for (const s of wiring.sensors) if (s.mcuPin) this.sensorOfPin.set(s.mcuPin, s.index);
    this.firstSensorPin = wiring.sensors.find((s) => s.mcuPin)?.mcuPin;
    this.rng = new Prng(sim.config.seed ^ 0x2545f491);
    this.module = new WebAssembly.Module(base64ToBytes(artifact.wasmBase64));
  }

  /** The controller to construct the Simulation with. */
  static controllerFor(wiring: FirmwareWiring): Controller {
    return new HalController(wiring);
  }

  private advance(us: number): void {
    this.tUs += us;
    while (this.tUs >= (this.sim.tMs + 1) * 1000) {
      if (this.sim.done) throw new Unwind("done");
      this.sim.step();
      this.onStep?.(this.sim.tMs);
      if (this.controller.resetRequested) throw new Unwind("reset");
    }
    if (this.sim.done) throw new Unwind("done");
  }

  private pinId(n: number): string {
    return this.pinIdOf.get(n) ?? `#${n}`;
  }

  private instantiate(): Exports {
    const mem: { memory?: WebAssembly.Memory } = {};
    const env = {
      hal_pin_mode: (pin: number, mode: number) => {
        const id = this.pinId(pin);
        const was = this.modes.get(id);
        this.modes.set(id, mode);
        if (was === 1 && mode !== 1) this.released.set(id, this.tUs);
        if (mode === 1 && !this.controller.levels.has(id)) this.controller.levels.set(id, 0);
        if (mode !== 1) this.controller.levels.delete(id);
        this.advance(HAL_COST_US.pinMode);
      },
      hal_digital_write: (pin: number, v: number) => {
        const id = this.pinId(pin);
        if (this.modes.get(id) === 1 || this.modes.get(id) === undefined)
          this.controller.levels.set(id, v ? 1 : 0);
        this.advance(HAL_COST_US.digitalWrite);
      },
      hal_digital_read: (pin: number) => {
        const id = this.pinId(pin);
        this.noteSample(id);
        const v = this.readDigital(id);
        this.advance(HAL_COST_US.digitalRead);
        return v;
      },
      hal_analog_read: (pin: number) => {
        const id = this.pinId(pin);
        this.noteSample(id);
        const v = this.readAnalog(id);
        this.advance(HAL_COST_US.analogRead);
        return v;
      },
      hal_analog_write: (pin: number, duty: number) => {
        this.controller.levels.set(this.pinId(pin), Math.max(0, Math.min(1, duty)));
        this.advance(HAL_COST_US.analogWrite);
      },
      hal_millis: () => Math.floor(this.tUs / 1000),
      hal_micros: () => Math.floor(this.tUs),
      hal_delay: (ms: number) => {
        if (ms >= 5) this.longCallList.push({ atMs: this.tUs / 1000, durationMs: ms });
        this.advance(Math.max(0, ms) * 1000);
      },
      hal_delay_us: (us: number) => {
        this.advance(Math.max(0, us));
      },
      hal_serial_write: (ptr: number, len: number) => {
        if (!mem.memory || this.serial.length > 64 * 1024) return;
        this.serial += new TextDecoder().decode(new Uint8Array(mem.memory.buffer, ptr, len));
      },
      hal_random: () => this.rng.nextU32(),
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      asin: Math.asin,
      acos: Math.acos,
      atan: Math.atan,
      atan2: Math.atan2,
      exp: Math.exp,
      log: Math.log,
      log10: Math.log10,
      pow: Math.pow,
      fmod: (a: number, b: number) => a % b,
    };
    const instance = new WebAssembly.Instance(this.module, { env });
    const ex = instance.exports as unknown as Exports;
    mem.memory = ex.memory;
    return ex;
  }

  private noteSample(pinId: string) {
    if (pinId === this.firstSensorPin) {
      const t = this.tUs / 1000;
      const last = this.sampleStampsMs.at(-1);
      if (last === undefined || t - last > 0.05) this.sampleStampsMs.push(t);
    }
  }

  private readAnalog(pinId: string): number {
    const i = this.sensorOfPin.get(pinId);
    const input = this.controller.latest;
    if (i === undefined || !input) return 0;
    return Math.max(0, Math.min(1, (input.sensors[i] ?? 0) / input.sensorMax));
  }

  private readDigital(pinId: string): number {
    const out = this.controller.levels.get(pinId);
    if (out !== undefined && this.modes.get(pinId) === 1) return out >= 0.5 ? 1 : 0;
    const i = this.sensorOfPin.get(pinId);
    const input = this.controller.latest;
    if (i === undefined || !input) return this.modes.get(pinId) === 2 ? 1 : 0;
    const v = input.sensors[i] ?? 0;
    if (input.sensorOutput === "rc") {
      const t0 = this.released.get(pinId);
      return t0 !== undefined && this.tUs - t0 < v ? 1 : 0;
    }
    if (input.sensorOutput === "digital") return v >= 0.5 ? 1 : 0;
    return v / input.sensorMax >= 0.5 ? 1 : 0;
  }

  /** Run the sketch until the simulation ends. */
  run(): SimResult {
    if (this.sim.tMs === 0) this.sim.step(); // first sensor reading before setup()
    this.tUs = this.sim.tMs * 1000;
    while (!this.sim.done) {
      this.controller.resetRequested = false;
      this.controller.levels.clear();
      this.modes.clear();
      const ex = this.instantiate();
      try {
        ex.hal_init();
        ex.setup();
        for (;;) {
          ex.loop();
          this.advance(HAL_COST_US.loop);
        }
      } catch (e) {
        if (!(e instanceof Unwind)) throw e;
        if (e.why === "reset") {
          this.resets++;
          continue;
        }
      }
    }
    return this.sim.result();
  }

  loopStats() {
    return periodStats(this.sampleStampsMs);
  }

  /** delay() calls of 5 ms or more (no source line on the HAL tier). */
  readonly longCallList: { atMs: number; durationMs: number }[] = [];
  longCalls() {
    return this.longCallList;
  }

  sampleTimesMs(): number[] {
    return [...this.sampleStampsMs];
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
