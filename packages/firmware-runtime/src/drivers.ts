/**
 * How each motor driver turns its logic inputs into a signed motor voltage. `level(pin)` is the
 * input's effective level: 0..1 (a PWM duty, or 0/1 for a digital level).
 */
export type DriverMode = "en-in" | "in-in" | "phase-en" | "drv8835";

export interface ChannelDef {
  mode: DriverMode;
  /** Logic inputs by role. en-in: en, in1, in2. in-in: in1, in2. phase-en: phase, en. drv8835: in1, in2, mode. */
  pins: Partial<Record<"en" | "in1" | "in2" | "phase" | "mode", string>>;
  /** Output pins [positive, negative]: positive duty drives out[0] high. */
  out: [string, string];
  /** All must be active for the channel to drive (else the motor coasts). */
  enables: { pin: string; activeLow?: boolean }[];
  /** Level of an input that isn't connected to anything (board pull-ups/downs, jumpers). */
  floating: Record<string, number>;
}

const enIn = (
  en: string,
  in1: string,
  in2: string,
  out: [string, string],
  extra: Partial<ChannelDef> = {},
): ChannelDef => ({
  mode: "en-in",
  pins: { en, in1, in2 },
  out,
  enables: [],
  floating: {},
  ...extra,
});
const inIn = (
  in1: string,
  in2: string,
  out: [string, string],
  extra: Partial<ChannelDef> = {},
): ChannelDef => ({
  mode: "in-in",
  pins: { in1, in2 },
  out,
  enables: [],
  floating: {},
  ...extra,
});

/** Channel definitions for every driver in the database (keyed by component id). */
export const DRIVER_CHANNELS: Record<string, ChannelDef[]> = {
  "driver.tb6612fng": [
    enIn("PWMA", "AIN1", "AIN2", ["AO1", "AO2"], { enables: [{ pin: "STBY" }] }),
    enIn("PWMB", "BIN1", "BIN2", ["BO1", "BO2"], { enables: [{ pin: "STBY" }] }),
  ],
  // Module boards ship with jumpers on ENA/ENB: unconnected = enabled at full duty.
  "driver.l298n-module": [
    enIn("ENA", "IN1", "IN2", ["OUT1", "OUT2"], { floating: { ENA: 1 } }),
    enIn("ENB", "IN3", "IN4", ["OUT3", "OUT4"], { floating: { ENB: 1 } }),
  ],
  "driver.l293d": [enIn("EN12", "1A", "2A", ["1Y", "2Y"]), enIn("EN34", "3A", "4A", ["3Y", "4Y"])],
  // Pololu's DRV8833 carrier pulls SLP high.
  "driver.drv8833-pololu": [
    inIn("AIN1", "AIN2", ["AOUT1", "AOUT2"], { enables: [{ pin: "SLP" }], floating: { SLP: 1 } }),
    inIn("BIN1", "BIN2", ["BOUT1", "BOUT2"], { enables: [{ pin: "SLP" }], floating: { SLP: 1 } }),
  ],
  "driver.drv8833-module": [
    inIn("IN1", "IN2", ["OUT1", "OUT2"], { enables: [{ pin: "EEP" }], floating: { EEP: 1 } }),
    inIn("IN3", "IN4", ["OUT3", "OUT4"], { enables: [{ pin: "EEP" }], floating: { EEP: 1 } }),
  ],
  // MODE low (the carrier's default): IN/IN; MODE high: PHASE (xIN1) / ENABLE (xIN2).
  "driver.drv8835-pololu": [
    {
      mode: "drv8835",
      pins: { in1: "AIN1", in2: "AIN2", mode: "MODE" },
      out: ["AOUT1", "AOUT2"],
      enables: [],
      floating: { MODE: 0 },
    },
    {
      mode: "drv8835",
      pins: { in1: "BIN1", in2: "BIN2", mode: "MODE" },
      out: ["BOUT1", "BOUT2"],
      enables: [],
      floating: { MODE: 0 },
    },
  ],
  "driver.drv8871": [inIn("IN1", "IN2", ["OUT1", "OUT2"])],
  "driver.l9110s-module": [
    inIn("A-IA", "A-IB", ["MA1", "MA2"]),
    inIn("B-IA", "B-IB", ["MB1", "MB2"]),
  ],
  "driver.mx1508-module": [inIn("IN1", "IN2", ["MA1", "MA2"]), inIn("IN3", "IN4", ["MB1", "MB2"])],
  // nEN is pulled low on the carrier (enabled).
  "driver.max14870-pololu": [
    {
      mode: "phase-en",
      pins: { phase: "DIR", en: "PWM" },
      out: ["M1", "M2"],
      enables: [{ pin: "EN", activeLow: true }],
      floating: { EN: 0 },
    },
  ],
  // IBT-2: both enables must be driven high.
  "driver.bts7960-ibt2": [
    inIn("RPWM", "LPWM", ["M+", "M-"], { enables: [{ pin: "R_EN" }, { pin: "L_EN" }] }),
  ],
};

/** Signed duty across the channel's outputs (−1..1); 0 when disabled or braking. */
export function channelDuty(def: ChannelDef, level: (pin: string) => number): number {
  for (const e of def.enables) {
    const high = level(e.pin) >= 0.5;
    if (e.activeLow ? high : !high) return 0;
  }
  const p = def.pins;
  const l = (pin: string | undefined) => (pin ? level(pin) : 0);
  switch (def.mode) {
    case "en-in": {
      const a = l(p.in1) >= 0.5;
      const b = l(p.in2) >= 0.5;
      return a === b ? 0 : (a ? 1 : -1) * l(p.en);
    }
    case "in-in":
      return l(p.in1) - l(p.in2);
    case "phase-en":
      return (l(p.phase) >= 0.5 ? -1 : 1) * l(p.en);
    case "drv8835":
      return l(p.mode) >= 0.5 ? (l(p.in1) >= 0.5 ? -1 : 1) * l(p.in2) : l(p.in1) - l(p.in2);
  }
}
