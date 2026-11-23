import type { Component } from "@linelab/schema";

/** An ATmega328P pin as Arduino numbers it, with its port bit, ADC channel and timer output. */
export interface AvrPin {
  /** Undefined for the analog-only A6/A7. */
  port?: "B" | "C" | "D";
  bit?: number;
  adc?: number;
  oc?: { timer: 0 | 1 | 2; channel: "A" | "B" };
}

const D = (bit: number, oc?: AvrPin["oc"]): AvrPin => ({ port: "D", bit, ...(oc ? { oc } : {}) });
const B = (bit: number, oc?: AvrPin["oc"]): AvrPin => ({ port: "B", bit, ...(oc ? { oc } : {}) });
const C = (bit: number): AvrPin => ({ port: "C", bit, adc: bit });

/** Uno, Nano and Pro Mini share the ATmega328P pinout. */
export const ATMEGA328P_PINS: Record<string, AvrPin> = {
  D0: D(0),
  D1: D(1),
  D2: D(2),
  D3: D(3, { timer: 2, channel: "B" }),
  D4: D(4),
  D5: D(5, { timer: 0, channel: "B" }),
  D6: D(6, { timer: 0, channel: "A" }),
  D7: D(7),
  D8: B(0),
  D9: B(1, { timer: 1, channel: "A" }),
  D10: B(2, { timer: 1, channel: "B" }),
  D11: B(3, { timer: 2, channel: "A" }),
  D12: B(4),
  D13: B(5),
  A0: C(0),
  A1: C(1),
  A2: C(2),
  A3: C(3),
  A4: C(4),
  A5: C(5),
  A6: { adc: 6 },
  A7: { adc: 7 },
};

/** Boards whose real firmware is emulated with avr8js. */
export const EMULATED_BOARDS = new Set([
  "mcu.arduino-nano",
  "mcu.arduino-uno-r3",
  "mcu.arduino-pro-mini-5v",
  "mcu.arduino-pro-mini-3v3",
]);

export function avrBoardFor(mcu: Component): { clockHz: number; avccV: number } | undefined {
  if (!EMULATED_BOARDS.has(mcu.id) || mcu.electrical.kind !== "mcu") return undefined;
  return { clockHz: mcu.electrical.clockMHz * 1e6, avccV: mcu.electrical.logicVoltageV };
}

/**
 * The number a HAL sketch uses for a pin: GPIO36 → 36, GP15 → 15, D7/A0 on AVR → Arduino numbers
 * (A0 = 14 on 328P-style numbering), PA0..PC15 → port × 16 + pin on STM32, plain "13" → 13.
 */
export function halPinNumber(pinId: string): number | undefined {
  let m = /^(?:GPIO|GP|IO)(\d+)$/.exec(pinId);
  if (m) return Number(m[1]);
  m = /^P([A-H])(\d+)$/.exec(pinId);
  if (m) return ((m[1] ?? "A").charCodeAt(0) - 65) * 16 + Number(m[2]);
  m = /^D(\d+)$/.exec(pinId);
  if (m) return Number(m[1]);
  m = /^A(\d+)$/.exec(pinId);
  if (m) return 14 + Number(m[1]);
  m = /^(\d+)$/.exec(pinId);
  if (m) return Number(m[1]);
  return undefined;
}
