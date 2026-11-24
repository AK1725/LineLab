import type { Controller, ControllerInput, MotorCommand } from "@linelab/sim-core";
import type { FirmwareArtifact, LineEntry, SourceLoc } from "@linelab/schema";
import { AvrMcu } from "./avr.js";
import { ATMEGA328P_PINS, avrBoardFor } from "./boards.js";
import {
  decode,
  defaultWatchType,
  LineMap,
  periodStats,
  watchableSymbols,
  type WatchType,
} from "./debug.js";
import { motorCommand, type FirmwareWiring } from "./wiring.js";

/** Calls into the core at least this long are recorded (blocking_delay detector). */
const LONG_CALL_MS = 5;
/** No sensor read for this long while in the sketch's own code = a stall (infinite_loop). */
const STALL_MS = 300;

/** Word addresses (1 = sketch code) from the rows of the line table that belong to .ino files. */
export function sketchMask(lines: readonly LineEntry[], flashWords = 16384): Uint8Array {
  const mask = new Uint8Array(flashWords);
  const rows = [...lines].sort((a, b) => a.address - b.address);
  rows.forEach((r, i) => {
    if (!r.file.endsWith(".ino")) return;
    const end = rows[i + 1]?.address ?? r.address + 2;
    for (let a = r.address >> 1; a < end >> 1 && a < flashWords; a++) mask[a] = 1;
  });
  return mask;
}

/**
 * Runs the user's compiled AVR firmware as the robot's controller: each simulated millisecond it
 * feeds the sensor readings to the ADC/GPIO, executes clockHz/1000 CPU cycles, and reads the
 * motor driver inputs back from the pins.
 */
export class AvrController implements Controller {
  readonly name = "firmware";
  mcu: AvrMcu;
  private readonly lines: LineMap;
  private readonly board: { clockHz: number; avccV: number };
  private readonly watched: { name: string; address: number; size: number; type: WatchType }[];
  private serialBefore = 0;
  /** Serial output across resets (brownouts restart the MCU). */
  private serialLog = "";

  constructor(
    readonly artifact: FirmwareArtifact,
    readonly wiring: FirmwareWiring,
    opts: { profile?: boolean } = {},
  ) {
    if (artifact.tier !== "emulated" || !artifact.hex)
      throw new Error("AvrController needs emulated (AVR) firmware.");
    const board = avrBoardFor(wiring.mcu);
    if (!board) throw new Error(`${wiring.mcu.name} isn't emulated; run it on the HAL tier.`);
    this.board = board;
    this.lines = new LineMap(artifact.lines);
    this.watched = watchableSymbols(artifact.symbols).map((s) => ({
      name: s.name,
      address: s.address,
      size: s.size,
      type: s.valueType ?? defaultWatchType(s.size),
    }));
    this.profile = opts.profile ?? false;
    this.mask = sketchMask(artifact.lines);
    this.mcu = this.boot();
  }

  private readonly profile: boolean;
  private resets = 0;
  /** Stretches with no sensor reads while the CPU stayed in the sketch (infinite loops). */
  private readonly stallList: { atMs: number; durationMs: number; pc: number }[] = [];
  private readonly mask: Uint8Array;

  private boot(): AvrMcu {
    const mcu = new AvrMcu(this.artifact.hex ?? "", {
      ...this.board,
      sampleEvery: this.profile ? 61 : 0,
    });
    mcu.sketchMask = this.mask;
    mcu.longCallCycles = (LONG_CALL_MS / 1000) * this.board.clockHz;
    const first = this.wiring.sensors.find((s) => s.mcuPin !== undefined)?.mcuPin;
    mcu.watchAdcChannel = first ? ATMEGA328P_PINS[first]?.adc : undefined;
    return mcu;
  }

  /** Brownout: the MCU restarts from scratch. */
  reset(): void {
    this.serialLog += this.mcu.serial.slice(this.serialBefore);
    this.serialBefore = 0;
    this.resets++;
    this.mcu = this.boot();
  }

  tick(input: ControllerInput): MotorCommand {
    const { mcu, wiring } = this;
    for (const s of wiring.sensors) {
      if (!s.mcuPin) continue;
      const emittersOff = s.emitters?.kind === "mcu" && mcu.outputLevel(s.emitters.pin) === 0;
      const raw = input.sensors[s.index] ?? 0;
      const v = emittersOff ? input.sensorMax : raw;
      if (input.sensorOutput === "analog")
        mcu.setAnalog(s.mcuPin, (v / input.sensorMax) * this.board.avccV);
      else if (input.sensorOutput === "digital") mcu.setDigital(s.mcuPin, v >= 0.5);
      else mcu.setRcDecay(s.mcuPin, v);
    }
    mcu.run(Math.round(this.board.clockHz / 1000));
    this.checkStall(input.tMs);
    return motorCommand(wiring, (pin) => mcu.outputLevel(pin));
  }

  private checkStall(tMs: number) {
    const last = this.mcu.sampleCycles.at(-1);
    if (last === undefined || this.mcu.inCore) return;
    const gapMs = ((this.mcu.cpu.cycles - last) / this.board.clockHz) * 1000;
    const cur = this.stallList.at(-1);
    const startMs = tMs - gapMs;
    if (gapMs >= STALL_MS) {
      if (cur && Math.abs(cur.atMs - startMs) < 2) cur.durationMs = gapMs;
      else this.stallList.push({ atMs: startMs, durationMs: gapMs, pc: this.mcu.lastSketchPc });
    }
  }

  private locOf(pc: number): SourceLoc | undefined {
    const l = pc >= 0 ? this.lines.lookup(pc * 2) : undefined;
    return l ? { file: l.file, line: l.line, exact: true } : undefined;
  }

  /** Calls from the sketch into the Arduino core that blocked ≥ 5 ms, with the calling line. */
  longCalls() {
    const toMs = (c: number) => (c / this.board.clockHz) * 1000;
    return this.mcu.longCalls.map((c) => {
      const loc = this.locOf(c.fromPc);
      return { atMs: toMs(c.startCycle), durationMs: toMs(c.cycles), ...(loc ? { loc } : {}) };
    });
  }

  stalls() {
    return this.stallList.map((s) => {
      const loc = this.locOf(s.pc);
      return { atMs: s.atMs, durationMs: s.durationMs, ...(loc ? { loc } : {}) };
    });
  }

  /** Times (ms) the first wired sensor was sampled. */
  sampleTimesMs(): number[] {
    return this.mcu.sampleCycles.map((c) => (c / this.board.clockHz) * 1000);
  }

  /** Values of the sketch's small globals (4-byte ones read as float by default). */
  watch(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const w of this.watched)
      out[w.name] = decode(this.mcu.readMemory(w.address, w.size), w.type);
    return out;
  }

  watchList() {
    return this.watched;
  }

  setWatchType(name: string, type: WatchType): void {
    const w = this.watched.find((x) => x.name === name);
    if (w) w.type = type;
  }

  /** Serial output since the start of the run. */
  get serial(): string {
    return this.serialLog + this.mcu.serial;
  }

  get resetCount(): number {
    return this.resets;
  }

  /** Control-loop period from the first sensor's ADC conversions. */
  loopStats() {
    return periodStats(this.mcu.sampleCycles.map((c) => (c / this.board.clockHz) * 1000));
  }

  /** Share of CPU time per source file (needs `profile: true`). */
  hotFiles() {
    const byFile = new Map<string, number>();
    let total = 0;
    for (const [pcWord, n] of this.mcu.pcSamples) {
      total += n;
      const f = this.lines.lookup(pcWord * 2)?.file ?? "?";
      byFile.set(f, (byFile.get(f) ?? 0) + n);
    }
    return [...byFile.entries()]
      .map(([file, n]) => ({ file, share: total > 0 ? n / total : 0 }))
      .sort((a, b) => b.share - a.share);
  }

  /** Source lines where the CPU spends its time (needs `profile: true`). */
  hotLines(limit = 10) {
    const byLine = new Map<string, { file: string; line: number; samples: number }>();
    let total = 0;
    for (const [pcWord, n] of this.mcu.pcSamples) {
      total += n;
      const l = this.lines.lookup(pcWord * 2);
      if (!l) continue;
      const k = `${l.file}:${l.line}`;
      const e = byLine.get(k) ?? { file: l.file, line: l.line, samples: 0 };
      e.samples += n;
      byLine.set(k, e);
    }
    return [...byLine.values()]
      .sort((a, b) => b.samples - a.samples)
      .slice(0, limit)
      .map((e) => ({ ...e, share: total > 0 ? e.samples / total : 0 }));
  }

  /** Source line of the instruction the CPU is at right now. */
  currentLine() {
    return this.lines.lookup(this.mcu.cpu.pc * 2);
  }
}
