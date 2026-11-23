import {
  ADCMuxInputType,
  AVRADC,
  AVRClock,
  AVRIOPort,
  AVRTimer,
  AVRUSART,
  CPU,
  PinState,
  adcConfig,
  avrInstruction,
  clockConfig,
  portBConfig,
  portCConfig,
  portDConfig,
  timer0Config,
  timer1Config,
  timer2Config,
  usart0Config,
} from "avr8js";
import { parseIntelHex } from "./hex.js";
import { ATMEGA328P_PINS, type AvrPin } from "./boards.js";

/** Data-space addresses of the 328P timer registers. */
const REG = {
  TCCR0A: 0x44,
  TCCR0B: 0x45,
  OCR0A: 0x47,
  OCR0B: 0x48,
  TCCR1A: 0x80,
  TCCR1B: 0x81,
  ICR1L: 0x86,
  OCR1AL: 0x88,
  OCR1BL: 0x8a,
  TCCR2A: 0xb0,
  TCCR2B: 0xb1,
  OCR2A: 0xb3,
  OCR2B: 0xb4,
} as const;

const SERIAL_CAP = 64 * 1024;

/**
 * An emulated ATmega328P running a compiled sketch (avr8js): GPIO ports, timers 0–2, the ADC and
 * USART0. The simulator sets analog voltages and digital inputs; it reads outputs and PWM duty
 * from the timer registers.
 */
export class AvrMcu {
  readonly cpu: CPU;
  readonly clockHz: number;
  private readonly ports: Record<"B" | "C" | "D", AVRIOPort>;
  private readonly adc: AVRADC;
  serial = "";
  /** Program-counter samples (word address → count), for the hot-line profiler. */
  readonly pcSamples = new Map<number, number>();
  /** Cycle stamps when the watched ADC channel started a conversion (loop-period profiler). */
  readonly sampleCycles: number[] = [];
  watchAdcChannel: number | undefined;
  private sinceSample = 0;
  /** RC sensors: decay time (µs) of each pin that is currently discharging. */
  private readonly rcDecayUs = new Map<string, number>();

  constructor(hex: string, opts: { clockHz: number; avccV: number; sampleEvery?: number }) {
    const flash = parseIntelHex(hex);
    this.cpu = new CPU(new Uint16Array(flash.buffer), 2048);
    this.clockHz = opts.clockHz;
    new AVRTimer(this.cpu, timer0Config);
    new AVRTimer(this.cpu, timer1Config);
    new AVRTimer(this.cpu, timer2Config);
    new AVRClock(this.cpu, opts.clockHz, clockConfig);
    this.ports = {
      B: new AVRIOPort(this.cpu, portBConfig),
      C: new AVRIOPort(this.cpu, portCConfig),
      D: new AVRIOPort(this.cpu, portDConfig),
    };
    const usart = new AVRUSART(this.cpu, usart0Config, opts.clockHz);
    usart.onByteTransmit = (b) => {
      if (this.serial.length < SERIAL_CAP) this.serial += String.fromCharCode(b);
    };
    this.adc = new AVRADC(this.cpu, adcConfig);
    this.adc.avcc = opts.avccV;
    const read = this.adc.onADCRead;
    this.adc.onADCRead = (input) => {
      if (input.type === ADCMuxInputType.SingleEnded && input.channel === this.watchAdcChannel)
        this.sampleCycles.push(this.cpu.cycles);
      read(input);
    };
    this.sampleEvery = opts.sampleEvery ?? 0;
    // RC sensors: when the firmware stops driving a charged pin, it reads high for the decay time.
    for (const [name, pin] of Object.entries(ATMEGA328P_PINS)) {
      if (!pin.port || pin.bit === undefined) continue;
      const port = this.ports[pin.port];
      const bit = pin.bit;
      let wasOutput = false;
      port.addListener(() => {
        const state = port.pinState(bit);
        const isOutput = state === PinState.High || state === PinState.Low;
        if (wasOutput && !isOutput) {
          const decay = this.rcDecayUs.get(name);
          if (decay !== undefined) {
            port.setPin(bit, true);
            this.cpu.addClockEvent(
              () => {
                port.setPin(bit, false);
              },
              Math.round((decay * this.clockHz) / 1e6),
            );
          }
        }
        wasOutput = isOutput;
      });
    }
  }

  private readonly sampleEvery: number;

  /** Run for `cycles` CPU cycles. */
  run(cycles: number): void {
    const cpu = this.cpu;
    const end = cpu.cycles + cycles;
    const every = this.sampleEvery;
    while (cpu.cycles < end) {
      avrInstruction(cpu);
      cpu.tick();
      if (every > 0 && ++this.sinceSample >= every) {
        this.sinceSample = 0;
        this.pcSamples.set(cpu.pc, (this.pcSamples.get(cpu.pc) ?? 0) + 1);
      }
    }
  }

  /** Simulated time since reset (ms). */
  get timeMs(): number {
    return (this.cpu.cycles / this.clockHz) * 1000;
  }

  setAnalog(pinId: string, volts: number): void {
    const p = ATMEGA328P_PINS[pinId];
    if (p?.adc !== undefined) this.adc.channelValues[p.adc] = volts;
  }

  setDigital(pinId: string, high: boolean): void {
    const p = ATMEGA328P_PINS[pinId];
    if (p?.port && p.bit !== undefined) this.ports[p.port].setPin(p.bit, high);
  }

  /** RC sensor decay time for a pin (µs); used the next time firmware releases the pin. */
  setRcDecay(pinId: string, us: number): void {
    this.rcDecayUs.set(pinId, us);
  }

  /** The pin's output level: PWM duty for an active timer output, 0/1 for GPIO, undefined if input. */
  outputLevel(pinId: string): number | undefined {
    const p: AvrPin | undefined = ATMEGA328P_PINS[pinId];
    if (!p?.port || p.bit === undefined) return undefined;
    const state = this.ports[p.port].pinState(p.bit);
    if (state !== PinState.High && state !== PinState.Low) return undefined;
    if (p.oc) {
      const duty = this.timerDuty(p.oc.timer, p.oc.channel);
      if (duty !== undefined) return duty;
    }
    return state === PinState.High ? 1 : 0;
  }

  /** Duty of a timer output compare channel, or undefined if the channel isn't driving the pin. */
  private timerDuty(timer: 0 | 1 | 2, ch: "A" | "B"): number | undefined {
    const d = this.cpu.data;
    const [tccrA, tccrB, ocrA, ocrB] =
      timer === 0
        ? [REG.TCCR0A, REG.TCCR0B, REG.OCR0A, REG.OCR0B]
        : timer === 2
          ? [REG.TCCR2A, REG.TCCR2B, REG.OCR2A, REG.OCR2B]
          : [REG.TCCR1A, REG.TCCR1B, REG.OCR1AL, REG.OCR1BL];
    const a = d[tccrA] ?? 0;
    const b = d[tccrB] ?? 0;
    const com = ch === "A" ? (a >> 6) & 3 : (a >> 4) & 3;
    if (com < 2 || (b & 7) === 0) return undefined; // disconnected, toggle mode, or timer stopped
    const ocr =
      timer === 1
        ? this.cpu.dataView.getUint16(ch === "A" ? ocrA : ocrB, true)
        : (d[ch === "A" ? ocrA : ocrB] ?? 0);
    let top = 0xff;
    let fast = false;
    if (timer === 1) {
      const wgm = (a & 3) | ((b >> 1) & 0x0c);
      const tops: Record<number, number> = {
        1: 0xff,
        2: 0x1ff,
        3: 0x3ff,
        5: 0xff,
        6: 0x1ff,
        7: 0x3ff,
      };
      if (wgm === 8 || wgm === 10 || wgm === 14) top = this.cpu.dataView.getUint16(REG.ICR1L, true);
      else if (wgm === 9 || wgm === 11 || wgm === 15)
        top = this.cpu.dataView.getUint16(REG.OCR1AL, true);
      else top = tops[wgm] ?? 0xff;
      fast = wgm === 5 || wgm === 6 || wgm === 7 || wgm === 14 || wgm === 15;
    } else {
      const wgm = (a & 3) | ((b >> 1) & 4);
      if (wgm === 5 || wgm === 7) top = d[ch === "A" ? ocrA : ocrA] ?? 0xff;
      fast = wgm === 3 || wgm === 7;
    }
    if (top <= 0) return 0;
    let duty = fast ? Math.min(1, (ocr + 1) / (top + 1)) : Math.min(1, ocr / top);
    // Fast PWM with OCR = 0 still outputs a one-cycle spike; treat as off.
    if (fast && ocr === 0) duty = 0;
    return com === 3 ? 1 - duty : duty;
  }

  /** Read `size` bytes of SRAM at a data-space address (little-endian). */
  readMemory(address: number, size: number): Uint8Array {
    return this.cpu.data.slice(address, address + size);
  }
}
