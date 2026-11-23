import { isMotorSupplyPin, mustPullHigh, needsPwm } from "@linelab/design-core";
import type { DesignCommand, Finding, FindingRef, Pin } from "@linelab/schema";
import {
  acceptedSupply,
  has,
  isConnected,
  isPowerPin,
  mcuOf,
  partsOf,
  type Circuit,
  type NetInfo,
  type PartRef,
  type PinRef,
} from "../circuit.js";
import type { Rule } from "../rule.js";

const pinRef = (r: PinRef): FindingRef => ({ kind: "pin", ref: `${r.part.id}/${r.pin.id}` });
const partRef = (p: PartRef): FindingRef => ({ kind: "placement", ref: p.id });
const netRef = (n: NetInfo): FindingRef => ({ kind: "net", ref: n.net.id });
const v = (x: number) => `${Number(x.toFixed(2))} V`;
const label = (r: PinRef) => `${r.part.id}.${r.pin.id}`;

function finding(
  rule: Pick<Rule, "id" | "severity">,
  message: string,
  explanation: string,
  affected: FindingRef[],
  fix?: { label: string; operations: DesignCommand[] },
): Finding {
  const f: Finding = { id: rule.id, severity: rule.severity, message, explanation, affected };
  if (fix) f.fix = fix;
  return f;
}

/** Pins on the same net as `r`, excluding `r` itself. */
const peers = (c: Circuit, r: PinRef) =>
  (c.net(r.part.id, r.pin.id)?.pins ?? []).filter((x) => x !== r);
const mcuPeers = (c: Circuit, r: PinRef) => peers(c, r).filter((x) => x.part.c.category === "mcu");
const motorPartsOf = (c: Circuit) =>
  partsOf(c, "motor").filter((m) => m.c.pins.some((p) => /^M[+-]$/.test(p.id)));

/** The motor driver output a motor terminal is wired to, if any. */
function driverOfMotor(c: Circuit, m: PartRef): PartRef | undefined {
  for (const pin of m.c.pins.filter((p) => /^M[+-]$/.test(p.id))) {
    const out = c.net(m.id, pin.id)?.pins.find((x) => has(x.pin, "motor_out"));
    if (out) return out.part;
  }
  return undefined;
}

/** Nominal voltage on a driver's motor-supply pin. */
function motorSupply(c: Circuit, d: PartRef): { nominal: number; net: NetInfo } | undefined {
  for (const pin of d.c.pins.filter((p) => isMotorSupplyPin(d.c, p))) {
    const net = c.net(d.id, pin.id);
    const bat = net?.sources.find((s) => s.ref.part.c.electrical.kind === "battery")?.ref.part.c
      .electrical;
    if (net && bat?.kind === "battery") return { nominal: bat.nominalVoltageV, net };
    if (net?.voltage) return { nominal: (net.voltage.min + net.voltage.max) / 2, net };
  }
  return undefined;
}

/** Estimated current (mA) drawn from a net by the parts it supplies. */
function loadOnNet(net: NetInfo): number {
  let mA = 0;
  for (const r of net.pins.filter((x) => has(x.pin, "power_in") && !has(x.pin, "power_out"))) {
    const e = r.part.c.electrical;
    if (e.kind === "line_sensor") mA += e.maxCurrentmA;
    else if (e.kind === "generic" && e.maxCurrentmA !== undefined) mA += e.maxCurrentmA;
    else if (e.kind === "mcu") mA += e.arch.startsWith("esp32") ? 250 : 50;
    else if (e.kind === "motor_driver" && !isMotorSupplyPin(r.part.c, r.pin)) mA += 5;
  }
  return mA;
}

const r = (id: string, severity: Rule["severity"], title: string, check: Rule["check"]): Rule => ({
  id,
  severity,
  category: "electrical",
  title,
  check,
});

export const ELECTRICAL_RULES: Rule[] = [
  r("elec.short-circuit", "error", "Supply shorted to ground", (c) =>
    c.nets
      .filter((n) => n.isGround && n.sources.length > 0)
      .map((n) =>
        finding(
          { id: "elec.short-circuit", severity: "error" },
          `Net "${n.net.name}" joins ${n.sources.map((s) => label(s.ref)).join(", ")} to ground.`,
          "A supply output connected straight to ground is a short circuit: the battery or regulator will overheat, trip, or be damaged.",
          [netRef(n), ...n.sources.map((s) => pinRef(s.ref))],
        ),
      ),
  ),

  r("elec.supply-conflict", "error", "Two different supplies joined", (c) =>
    c.nets.flatMap((n) => {
      const known = n.sources.filter((s) => s.voltage !== undefined);
      const parts = new Set(known.map((s) => s.ref.part.id));
      if (parts.size < 2) return [];
      const lo = Math.min(...known.map((s) => s.voltage?.max ?? 0));
      const hi = Math.max(...known.map((s) => s.voltage?.max ?? 0));
      if (hi - lo < 0.25) return [];
      return [
        finding(
          { id: "elec.supply-conflict", severity: "error" },
          `Net "${n.net.name}" connects supplies at ${v(lo)} and ${v(hi)} (${known.map((s) => label(s.ref)).join(", ")}).`,
          "Two outputs at different voltages fight each other; current flows backwards into the lower one and can destroy a regulator or a USB port.",
          [netRef(n), ...known.map((s) => pinRef(s.ref))],
        ),
      ];
    }),
  ),

  r("elec.reverse-polarity", "error", "Battery negative wired to a supply input", (c) =>
    partsOf(c, "battery").flatMap((b) => {
      const neg = b.c.pins.find((p) => has(p, "gnd"));
      const n = neg && c.net(b.id, neg.id);
      const wrong =
        n?.pins.filter((x) => x.part !== b && has(x.pin, "power_in") && !has(x.pin, "gnd")) ?? [];
      return wrong.length > 0 && neg
        ? [
            finding(
              { id: "elec.reverse-polarity", severity: "error" },
              `${b.id}'s negative terminal goes to ${wrong.map(label).join(", ")}.`,
              "Reversed battery polarity destroys most boards instantly. Battery − must go to GND; battery + to the supply input.",
              [pinRef({ part: b, pin: neg }), ...wrong.map(pinRef)],
            ),
          ]
        : [];
    }),
  ),

  r("elec.missing-common-ground", "error", "Parts without a shared ground", (c) => {
    const wiredParts = c.parts.filter(
      (p) => isConnected(c, p) && p.c.pins.some((q) => has(q, "gnd")),
    );
    if (wiredParts.length < 2) return [];
    const gndNets = new Map<string, PartRef[]>();
    const missing: PinRef[] = [];
    for (const p of wiredParts) {
      for (const pin of p.c.pins.filter((q) => has(q, "gnd"))) {
        const n = c.net(p.id, pin.id);
        if (!n) missing.push({ part: p, pin });
        else gndNets.set(n.net.id, [...(gndNets.get(n.net.id) ?? []), p]);
      }
    }
    const unreferenced = wiredParts.filter(
      (p) => !p.c.pins.some((q) => has(q, "gnd") && c.net(p.id, q.id)),
    );
    if (gndNets.size <= 1 && unreferenced.length === 0) return [];
    const anchor = [...c.nets]
      .filter((n) => n.isGround)
      .sort((a, b) => b.pins.length - a.pins.length)[0];
    const anchorPin = anchor?.pins.find((x) => has(x.pin, "gnd"));
    const ops: DesignCommand[] = anchorPin
      ? missing
          .filter((m) => unreferenced.includes(m.part) || gndNets.size > 1)
          .map((m) => ({
            type: "connect" as const,
            a: { instanceId: anchorPin.part.id, pinId: anchorPin.pin.id },
            b: { instanceId: m.part.id, pinId: m.pin.id },
          }))
          .concat(
            [...c.nets.filter((n) => n.isGround && n !== anchor)].flatMap((n) => {
              const g = n.pins.find((x) => has(x.pin, "gnd"));
              return g
                ? [
                    {
                      type: "connect" as const,
                      a: { instanceId: anchorPin.part.id, pinId: anchorPin.pin.id },
                      b: { instanceId: g.part.id, pinId: g.pin.id },
                    },
                  ]
                : [];
            }),
          )
      : [];
    return [
      finding(
        { id: "elec.missing-common-ground", severity: "error" },
        unreferenced.length > 0
          ? `${unreferenced.map((p) => p.id).join(", ")} ${unreferenced.length === 1 ? "has" : "have"} no ground connection.`
          : `Ground is split into ${gndNets.size} separate nets.`,
        "Signals are measured against ground. Without one shared ground between the battery, driver, MCU and sensors, logic levels are meaningless and parts behave randomly.",
        [...unreferenced.map(partRef), ...missing.map(pinRef)],
        ops.length > 0 ? { label: "Join all grounds", operations: ops } : undefined,
      ),
    ];
  }),

  r("elec.unpowered", "error", "Part has no supply", (c) =>
    c.parts
      .filter((p) =>
        [
          "mcu",
          "motor_driver",
          "line_sensor",
          "sensor",
          "communication",
          "display",
          "regulator",
        ].includes(p.c.category),
      )
      .filter((p) => isConnected(c, p))
      .filter((p) => {
        const inputs = p.c.pins.filter(
          (q) => has(q, "power_in") && !/AREF|ADC_VREF|3V3_EN|SHDN|^EN$/i.test(q.id),
        );
        if (inputs.length === 0) return false;
        // MCUs can be fed through any supply pin, including their 5 V / 3V3 pins.
        const anyIn =
          p.c.category === "mcu"
            ? p.c.pins.filter((q) => has(q, "power_in", "power_out") && !has(q, "gnd"))
            : inputs;
        if (p.c.category === "mcu")
          return !anyIn.some((q) => c.net(p.id, q.id)?.voltage !== undefined);
        if (p.c.category === "motor_driver") return inputs.some((q) => !c.net(p.id, q.id));
        return !inputs.some((q) => c.net(p.id, q.id));
      })
      .map((p) =>
        finding(
          { id: "elec.unpowered", severity: "error" },
          `${p.id} (${p.c.name}) has no power connected.`,
          p.c.category === "motor_driver"
            ? "Motor drivers need both a motor supply (VM/VMOT/VIN) and, on most boards, a logic supply (VCC)."
            : "Every active part needs its supply pin connected to a powered net.",
          [partRef(p)],
        ),
      ),
  ),

  r("elec.supply-overvoltage", "error", "Supply voltage above the part's maximum", (c) =>
    c.parts.flatMap((p) =>
      p.c.pins.flatMap((pin) => {
        if (!has(pin, "power_in") || has(pin, "power_out")) return [];
        const n = c.net(p.id, pin.id);
        const ok = acceptedSupply(p, pin);
        if (!n?.voltage || !ok || n.voltage.max <= ok.max + 0.05) return [];
        return [
          finding(
            { id: "elec.supply-overvoltage", severity: "error" },
            `${label({ part: p, pin })} gets up to ${v(n.voltage.max)}; ${p.c.name} allows ${v(ok.min)}–${v(ok.max)}.`,
            "Exceeding the maximum supply voltage permanently damages the part. Use a regulator or a lower-voltage battery.",
            [pinRef({ part: p, pin }), netRef(n)],
          ),
        ];
      }),
    ),
  ),

  r("elec.supply-undervoltage", "warning", "Supply can drop below the part's minimum", (c) =>
    c.parts.flatMap((p) =>
      p.c.pins.flatMap((pin) => {
        if (!has(pin, "power_in") || has(pin, "power_out")) return [];
        const n = c.net(p.id, pin.id);
        const ok = acceptedSupply(p, pin);
        if (!n?.voltage || !ok || n.voltage.min >= ok.min - 0.05 || n.voltage.max > ok.max + 0.05)
          return [];
        return [
          finding(
            { id: "elec.supply-undervoltage", severity: "warning" },
            `${label({ part: p, pin })} can fall to ${v(n.voltage.min)}; ${p.c.name} needs at least ${v(ok.min)}.`,
            "As the battery discharges the part drops out or resets (a classic cause of 'random' resets mid-run). Use a regulator with enough headroom or a higher-voltage pack.",
            [pinRef({ part: p, pin }), netRef(n)],
          ),
        ];
      }),
    ),
  ),

  r("elec.io-overvoltage", "error", "Signal above a pin's voltage limit", (c) =>
    c.nets.flatMap((n) =>
      n.pins.flatMap((rp) => {
        if (isPowerPin(rp.pin) || rp.pin.fiveVoltTolerant === true) return [];
        const domain =
          rp.pin.voltageDomainV ??
          (rp.part.c.electrical.kind === "mcu" ? rp.part.c.electrical.logicVoltageV : undefined);
        if (domain === undefined) return [];
        const level = c.driveLevel(n, rp);
        if (level === undefined || level <= domain + 0.3) return [];
        return [
          finding(
            { id: "elec.io-overvoltage", severity: "error" },
            `${label(rp)} is a ${v(domain)} pin but net "${n.net.name}" carries ${v(level)}.`,
            "Driving a pin above its supply forces current through its protection diodes and can destroy it. Use a level shifter or a resistor divider, or power the other part from the lower voltage.",
            [pinRef(rp), netRef(n)],
          ),
        ];
      }),
    ),
  ),

  r("elec.regulator-dropout", "warning", "Regulator input too close to its output", (c) =>
    partsOf(c, "regulator").flatMap((p) => {
      const e = p.c.electrical;
      if (e.kind !== "regulator" || e.topology === "boost" || e.topology === "buck-boost")
        return [];
      const inPin = p.c.pins.find((q) => has(q, "power_in") && !has(q, "enable"));
      const n = inPin && c.net(p.id, inPin.id);
      const need = e.outputVoltage.max + (e.dropoutV ?? 1);
      if (!n?.voltage || n.voltage.min >= need || e.outputVoltage.min !== e.outputVoltage.max)
        return [];
      return [
        finding(
          { id: "elec.regulator-dropout", severity: "warning" },
          `${p.id} needs about ${v(need)} in to hold ${v(e.outputVoltage.max)}, but its input can sag to ${v(n.voltage.min)}.`,
          "Below input = output + dropout, the regulated rail sags too and the MCU may brown out late in a run. Choose a low-dropout or buck-boost regulator.",
          [partRef(p)],
        ),
      ];
    }),
  ),

  r("elec.regulator-overload", "warning", "Regulator loaded beyond its rating", (c) =>
    partsOf(c, "regulator").flatMap((p) => {
      const e = p.c.electrical;
      const out = p.c.pins.find((q) => has(q, "power_out"));
      const n = out && c.net(p.id, out.id);
      if (e.kind !== "regulator" || !n) return [];
      const mA = loadOnNet(n);
      return mA > e.maxOutputCurrentA * 1000
        ? [
            finding(
              { id: "elec.regulator-overload", severity: "warning" },
              `${p.id} supplies about ${Math.round(mA)} mA; it is rated ${e.maxOutputCurrentA} A.`,
              "An overloaded regulator overheats or lets its output sag. Move some loads to another supply or pick a bigger regulator.",
              [partRef(p), netRef(n)],
            ),
          ]
        : [];
    }),
  ),

  r("elec.linear-regulator-heat", "warning", "Linear regulator will run hot", (c) =>
    partsOf(c, "regulator").flatMap((p) => {
      const e = p.c.electrical;
      const inPin = p.c.pins.find((q) => has(q, "power_in"));
      const out = p.c.pins.find((q) => has(q, "power_out"));
      const nin = inPin && c.net(p.id, inPin.id);
      const nout = out && c.net(p.id, out.id);
      if (e.kind !== "regulator" || e.topology !== "linear" || !nin?.voltage || !nout) return [];
      const watts = ((nin.voltage.max - e.outputVoltage.max) * loadOnNet(nout)) / 1000;
      return watts > 0.75
        ? [
            finding(
              { id: "elec.linear-regulator-heat", severity: "warning" },
              `${p.id} burns about ${watts.toFixed(2)} W as heat.`,
              "A linear regulator turns (Vin − Vout) × I into heat. Above roughly 0.75 W a small package without a heatsink gets very hot; a buck converter wastes far less.",
              [partRef(p)],
            ),
          ]
        : [];
    }),
  ),

  r("elec.adjustable-regulator", "tip", "Adjustable regulator output not fixed", (c) =>
    partsOf(c, "regulator")
      .filter(
        (p) =>
          p.c.electrical.kind === "regulator" &&
          p.c.electrical.outputVoltage.min !== p.c.electrical.outputVoltage.max,
      )
      .filter((p) => p.c.pins.some((q) => has(q, "power_out") && c.net(p.id, q.id)))
      .map((p) =>
        finding(
          { id: "elec.adjustable-regulator", severity: "tip" },
          `${p.id} is adjustable: set its output with the trimpot before connecting anything to it.`,
          "Cheap adjustable modules often ship set to their maximum output. LineLab can't check voltages on a net fed by an adjustable regulator.",
          [partRef(p)],
        ),
      ),
  ),

  r("elec.motor-direct-mcu", "error", "Motor wired straight to the microcontroller", (c) =>
    motorPartsOf(c).flatMap((m) =>
      m.c.pins
        .filter((p) => /^M[+-]$/.test(p.id))
        .flatMap((pin) => {
          const mcus = mcuPeers(c, { part: m, pin });
          return mcus.length > 0
            ? [
                finding(
                  { id: "elec.motor-direct-mcu", severity: "error" },
                  `${label({ part: m, pin })} connects directly to ${mcus.map(label).join(", ")}.`,
                  "A microcontroller pin supplies about 20–40 mA; a motor needs hundreds of mA and makes voltage spikes. Always drive motors through a motor driver.",
                  [pinRef({ part: m, pin }), ...mcus.map(pinRef)],
                ),
              ]
            : [];
        }),
    ),
  ),

  r("elec.motor-unconnected", "warning", "Motor not connected to a driver", (c) =>
    motorPartsOf(c)
      .filter((m) => partsOf(c, "motor_driver").length > 0 && !driverOfMotor(c, m))
      .map((m) =>
        finding(
          { id: "elec.motor-unconnected", severity: "warning" },
          `${m.id} is not wired to any motor driver output.`,
          "Connect both motor terminals to one driver channel (e.g. AO1 and AO2).",
          [partRef(m)],
        ),
      ),
  ),

  r("elec.motor-stall-current", "warning", "Motor stall current exceeds driver peak", (c) =>
    motorPartsOf(c).flatMap((m) => {
      const d = driverOfMotor(c, m);
      const me = m.c.electrical;
      const de = d?.c.electrical;
      if (
        !d ||
        me.kind !== "motor" ||
        de?.kind !== "motor_driver" ||
        me.stallCurrentA <= de.peakCurrentPerChannelA
      )
        return [];
      return [
        finding(
          { id: "elec.motor-stall-current", severity: "warning" },
          `${m.id} can draw ${me.stallCurrentA} A at stall; ${d.c.name} handles ${de.peakCurrentPerChannelA} A peak per channel.`,
          "Every start, reversal or blocked wheel briefly draws stall current. The driver will current-limit, shut down, or overheat. Use a stronger driver or limit acceleration in firmware.",
          [partRef(m), partRef(d)],
        ),
      ];
    }),
  ),

  r("elec.motor-overvoltage", "warning", "Motor supply well above motor rating", (c) =>
    motorPartsOf(c).flatMap((m) => {
      const d = driverOfMotor(c, m);
      const me = m.c.electrical;
      const de = d?.c.electrical;
      const s = d && motorSupply(c, d);
      if (!d || !s || me.kind !== "motor" || de?.kind !== "motor_driver") return [];
      const atMotor = s.nominal - de.voltageDropV;
      return atMotor > me.ratedVoltageV * 1.35
        ? [
            finding(
              { id: "elec.motor-overvoltage", severity: "warning" },
              `${m.id} is rated ${v(me.ratedVoltageV)} but sees about ${v(atMotor)} at full PWM.`,
              "Over-volting a small gearmotor shortens brush and gearbox life. Cap the PWM duty in firmware (e.g. to rated/supply) or use higher-voltage motors.",
              [partRef(m)],
            ),
          ]
        : [];
    }),
  ),

  r("elec.driver-drop", "warning", "Driver loses too much voltage", (c) =>
    motorPartsOf(c).flatMap((m) => {
      const d = driverOfMotor(c, m);
      const me = m.c.electrical;
      const de = d?.c.electrical;
      const s = d && motorSupply(c, d);
      if (!d || !s || me.kind !== "motor" || de?.kind !== "motor_driver") return [];
      const atMotor = s.nominal - de.voltageDropV;
      return de.voltageDropV >= 1 && atMotor < me.ratedVoltageV * 0.75
        ? [
            finding(
              { id: "elec.driver-drop", severity: "warning" },
              `${d.c.name} drops about ${v(de.voltageDropV)}, leaving ${m.id} only ${v(atMotor)} of its ${v(me.ratedVoltageV)} rating.`,
              "Bipolar drivers such as the L298N and L293D waste 2–3 V. A MOSFET driver (TB6612FNG, DRV8833) passes almost all of the battery voltage to the motors.",
              [partRef(d), partRef(m)],
            ),
          ]
        : [];
    }),
  ),

  r("elec.battery-current", "warning", "Motors can draw more than the battery delivers", (c) =>
    partsOf(c, "battery").flatMap((b) => {
      const e = b.c.electrical;
      const stall = motorPartsOf(c)
        .filter((m) => driverOfMotor(c, m))
        .reduce(
          (s, m) => s + (m.c.electrical.kind === "motor" ? m.c.electrical.stallCurrentA : 0),
          0,
        );
      return e.kind === "battery" && stall > e.maxContinuousDischargeA && isConnected(c, b)
        ? [
            finding(
              { id: "elec.battery-current", severity: "warning" },
              `Motors can draw ${stall.toFixed(1)} A together; ${b.c.name} supplies ${e.maxContinuousDischargeA} A continuous.`,
              "When both motors start or stall the pack voltage collapses and the MCU can reset. Use a pack with a higher discharge rating.",
              [partRef(b)],
            ),
          ]
        : [];
    }),
  ),

  r("elec.nine-volt-battery", "warning", "High-resistance battery powering motors", (c) =>
    partsOf(c, "battery").flatMap((b) => {
      const e = b.c.electrical;
      const plus = b.c.pins.find((p) => has(p, "power_out"));
      const n = plus && c.net(b.id, plus.id);
      const feedsMotors = n?.pins.some(
        (x) => x.part.c.category === "motor_driver" && isMotorSupplyPin(x.part.c, x.pin),
      );
      return e.kind === "battery" && e.internalResistanceMilliohm >= 1000 && feedsMotors
        ? [
            finding(
              { id: "elec.nine-volt-battery", severity: "warning" },
              `${b.c.name} (≈${(e.internalResistanceMilliohm / 1000).toFixed(1)} Ω internal resistance) powers the motors.`,
              "Under motor load the voltage collapses (V = I·R), the microcontroller browns out, and the robot stutters or resets. Use a LiPo or Li-ion pack.",
              [partRef(b)],
            ),
          ]
        : [];
    }),
  ),

  r("elec.standby-unconnected", "error", "Driver standby pin not held high", (c) =>
    partsOf(c, "motor_driver").flatMap((d) =>
      d.c.pins.filter(mustPullHigh).flatMap((pin) => {
        const n = c.net(d.id, pin.id);
        const high =
          n && (n.voltage !== undefined || n.pins.some((x) => x.part.c.category === "mcu"));
        if (high || !isConnected(c, d)) return [];
        const mcu = mcuOf(c);
        const logic =
          mcu?.c.electrical.kind === "mcu"
            ? mcu.c.pins.find(
                (q) =>
                  has(q, "power_out") &&
                  q.voltageDomainV ===
                    (mcu.c.electrical.kind === "mcu" ? mcu.c.electrical.logicVoltageV : 0),
              )
            : undefined;
        return [
          finding(
            { id: "elec.standby-unconnected", severity: "error" },
            `${label({ part: d, pin })} is ${n ? "not driven high" : "unconnected"}: the motors will never move.`,
            "The TB6612FNG starts in standby. STBY must be tied to the logic supply (or a GPIO set HIGH).",
            [pinRef({ part: d, pin })],
            mcu && logic
              ? {
                  label: `Tie ${pin.id} to ${mcu.id}.${logic.id}`,
                  operations: [
                    {
                      type: "connect",
                      a: { instanceId: d.id, pinId: pin.id },
                      b: { instanceId: mcu.id, pinId: logic.id },
                    },
                  ],
                }
              : undefined,
          ),
        ];
      }),
    ),
  ),

  r("elec.driver-input-floating", "warning", "Driver control input not connected", (c) =>
    partsOf(c, "motor_driver")
      .filter((d) => d.c.pins.some((p) => has(p, "motor_out") && c.net(d.id, p.id)))
      .flatMap((d) =>
        d.c.pins
          .filter(
            (p) =>
              has(p, "digital", "pwm") &&
              !isPowerPin(p) &&
              !has(p, "motor_out", "enable") &&
              !/FAULT|FLT|_IS$|^PG$|MODE/i.test(p.id),
          )
          .filter((p) => !c.net(d.id, p.id))
          .map((p) =>
            finding(
              { id: "elec.driver-input-floating", severity: "warning" },
              `${label({ part: d, pin: p })} is not connected.`,
              "Unconnected control inputs read as LOW (or float), so that motor channel can't be driven. Wire it to a microcontroller pin.",
              [pinRef({ part: d, pin: p })],
            ),
          ),
      ),
  ),

  r("elec.pwm-pin-required", "warning", "Speed input on a pin without PWM", (c) =>
    partsOf(c, "motor_driver").flatMap((d) =>
      d.c.pins
        .filter((p) => needsPwm(d.c, p))
        .flatMap((pin) =>
          mcuPeers(c, { part: d, pin })
            .filter((m) => !has(m.pin, "pwm"))
            .map((m) =>
              finding(
                { id: "elec.pwm-pin-required", severity: "warning" },
                `${label({ part: d, pin })} (speed) is on ${label(m)}, which has no hardware PWM.`,
                "Without PWM the motor can only run at full speed or stop, which makes smooth PID line following impossible. Move it to a PWM-capable pin.",
                [pinRef({ part: d, pin }), pinRef(m)],
              ),
            ),
        ),
    ),
  ),

  r("elec.adc-pin-required", "error", "Analog sensor on a pin without an ADC", (c) =>
    partsOf(c, "line_sensor")
      .filter(
        (s) => s.c.electrical.kind === "line_sensor" && s.c.electrical.outputType === "analog",
      )
      .flatMap((s) =>
        s.c.pins
          .filter((p) => has(p, "analog") && !isPowerPin(p))
          .flatMap((pin) =>
            mcuPeers(c, { part: s, pin })
              .filter((m) => !has(m.pin, "analog"))
              .map((m) =>
                finding(
                  { id: "elec.adc-pin-required", severity: "error" },
                  `${label({ part: s, pin })} (analog) goes to ${label(m)}, which can't read analog voltages.`,
                  "analogRead() only works on ADC pins (A0–A7 on Nano/Uno). On a digital pin you get just black/white with no position in between.",
                  [pinRef({ part: s, pin }), pinRef(m)],
                ),
              ),
          ),
      ),
  ),

  r("elec.esp32-adc2-wifi", "warning", "ESP32 ADC2 pin used for an analog sensor", (c) =>
    c.parts.flatMap((p) =>
      p.c.pins
        .filter((pin) => pin.adcUnit === 2)
        .flatMap((pin) => {
          const sensors = peers(c, { part: p, pin }).filter(
            (x) => has(x.pin, "analog") && x.part.c.category !== "mcu",
          );
          return sensors.length > 0
            ? [
                finding(
                  { id: "elec.esp32-adc2-wifi", severity: "warning" },
                  `${label({ part: p, pin })} is an ADC2 input (${sensors.map(label).join(", ")}).`,
                  "On the ESP32, ADC2 cannot be read while WiFi (or ESP-NOW/Bluetooth on some cores) is active. Use ADC1 pins (GPIO32–39) for sensors if you plan to use wireless tuning.",
                  [pinRef({ part: p, pin }), ...sensors.map(pinRef)],
                ),
              ]
            : [];
        }),
    ),
  ),

  r("elec.input-only-pin", "error", "Input-only pin used as an output", (c) =>
    c.parts.flatMap((p) =>
      p.c.pins
        .filter((pin) => pin.inputOnly === true)
        .flatMap((pin) => {
          const consumers = peers(c, { part: p, pin }).filter(
            (x) =>
              x.part.c.category !== "mcu" &&
              (x.part.c.category === "motor_driver" || x.part.c.category === "indicator") &&
              !isPowerPin(x.pin),
          );
          return consumers.length > 0
            ? [
                finding(
                  { id: "elec.input-only-pin", severity: "error" },
                  `${label({ part: p, pin })} can only read, but it drives ${consumers.map(label).join(", ")}.`,
                  "ESP32 GPIO34–39 have no output driver. Move this connection to an output-capable pin.",
                  [pinRef({ part: p, pin }), ...consumers.map(pinRef)],
                ),
              ]
            : [];
        }),
    ),
  ),

  r("elec.strapping-pin", "tip", "Boot strapping pin in use", (c) =>
    c.parts.flatMap((p) =>
      p.c.pins
        .filter((pin) => /Strapping/i.test(pin.notes ?? "") && c.net(p.id, pin.id))
        .map((pin) =>
          finding(
            { id: "elec.strapping-pin", severity: "tip" },
            `${label({ part: p, pin })} is a boot strapping pin.`,
            "Strapping pins are sampled at reset; a sensor or driver pulling them the wrong way can stop the board from booting or uploading. Prefer other pins if any are free.",
            [pinRef({ part: p, pin })],
          ),
        ),
    ),
  ),

  r("elec.serial-pin", "tip", "USB serial pin in use", (c) =>
    c.parts.flatMap((p) =>
      p.c.pins
        .filter(
          (pin) =>
            /USB serial/i.test(pin.notes ?? "") &&
            c.net(p.id, pin.id) &&
            peers(c, { part: p, pin }).some((x) => x.part !== p),
        )
        .map((pin) =>
          finding(
            { id: "elec.serial-pin", severity: "tip" },
            `${label({ part: p, pin })} is shared with USB serial.`,
            "Anything on D0/D1 can block uploads and garbles Serial.print debugging. Move it elsewhere if you can.",
            [pinRef({ part: p, pin })],
          ),
        ),
    ),
  ),

  r("elec.i2c-address-conflict", "error", "Two I2C devices with the same address", (c) => {
    const byNet = new Map<string, PartRef[]>();
    for (const p of c.parts.filter((x) => x.c.i2cAddresses && x.c.category !== "mcu")) {
      const sda = p.c.pins.find((q) => has(q, "i2c_sda"));
      const n = sda && c.net(p.id, sda.id);
      if (n) byNet.set(n.net.id, [...(byNet.get(n.net.id) ?? []), p]);
    }
    return [...byNet.values()].flatMap((devs) => {
      const seen = new Map<number, PartRef>();
      const out: Finding[] = [];
      for (const d of devs) {
        const addr = d.c.i2cAddresses?.[0];
        if (addr === undefined) continue;
        const other = seen.get(addr);
        if (other) {
          out.push(
            finding(
              { id: "elec.i2c-address-conflict", severity: "error" },
              `${other.id} and ${d.id} both use I2C address 0x${addr.toString(16)}.`,
              "Two devices answering the same address corrupt each other's data. Change one address (if it has an address pin), use a different bus, or add an I2C multiplexer.",
              [partRef(other), partRef(d)],
            ),
          );
        } else seen.set(addr, d);
      }
      return out;
    });
  }),

  r("elec.i2c-pins", "warning", "I2C device on non-I2C pins", (c) =>
    c.parts
      .filter((p) => p.c.category !== "mcu")
      .flatMap((p) =>
        p.c.pins
          .filter((pin) => has(pin, "i2c_sda", "i2c_scl"))
          .flatMap((pin) =>
            mcuPeers(c, { part: p, pin })
              .filter((m) => !has(m.pin, has(pin, "i2c_sda") ? "i2c_sda" : "i2c_scl"))
              .map((m) =>
                finding(
                  { id: "elec.i2c-pins", severity: "warning" },
                  `${label({ part: p, pin })} goes to ${label(m)}, which is not the board's hardware I2C pin.`,
                  "The Wire library uses fixed pins (A4/A5 on Uno/Nano). Elsewhere you need a software-I2C library or a different pin mapping.",
                  [pinRef({ part: p, pin }), pinRef(m)],
                ),
              ),
          ),
      ),
  ),

  r("elec.uart-crossed", "error", "Serial TX/RX wired the wrong way", (c) =>
    c.nets.flatMap((n) => {
      const tx = n.pins.filter((x) => has(x.pin, "uart_tx"));
      const rx = n.pins.filter((x) => has(x.pin, "uart_rx"));
      const sameDir = tx.length >= 2 ? tx : rx.length >= 2 && tx.length === 0 ? rx : [];
      const parts = new Set(sameDir.map((x) => x.part.id));
      return parts.size >= 2
        ? [
            finding(
              { id: "elec.uart-crossed", severity: "error" },
              `Net "${n.net.name}" joins ${sameDir.map(label).join(" and ")}.`,
              "Serial lines cross over: one side's TX goes to the other side's RX. TX↔TX or RX↔RX never communicates (and two TX outputs fight).",
              sameDir.map(pinRef),
            ),
          ]
        : [];
    }),
  ),

  r("elec.switch-current", "warning", "Switch too weak for the motor current", (c) =>
    c.parts
      .filter(
        (p) =>
          p.c.category === "input" &&
          p.c.electrical.kind === "generic" &&
          p.c.electrical.maxCurrentmA !== undefined,
      )
      .flatMap((p) => {
        const nets = p.c.pins
          .map((q) => c.net(p.id, q.id))
          .filter((n): n is NetInfo => n !== undefined);
        const onBattery = nets.some((n) =>
          n.sources.some((s) => s.ref.part.c.category === "battery"),
        );
        const motors = motorPartsOf(c).filter((m) => driverOfMotor(c, m));
        const stall =
          motors.reduce(
            (s, m) => s + (m.c.electrical.kind === "motor" ? m.c.electrical.stallCurrentA : 0),
            0,
          ) * 1000;
        const rating =
          p.c.electrical.kind === "generic" ? (p.c.electrical.maxCurrentmA ?? Infinity) : Infinity;
        return onBattery && stall > rating
          ? [
              finding(
                { id: "elec.switch-current", severity: "warning" },
                `${p.c.name} (${rating} mA) switches the battery feeding motors that can draw ${(stall / 1000).toFixed(1)} A.`,
                "Small slide switches weld or burn when they carry motor current. Use a rocker switch rated for several amps.",
                [partRef(p)],
              ),
            ]
          : [];
      }),
  ),

  r("elec.led-resistor", "warning", "LED without a current-limiting resistor", (c) =>
    partsOf(c, "indicator")
      .filter((p) => /LED/.test(p.c.name) && !/WS2812/i.test(p.c.name))
      .flatMap((p) => {
        const anode = p.c.pins.find((q) => q.id === "A");
        const k = p.c.pins.find((q) => q.id === "K");
        const an = anode && c.net(p.id, anode.id);
        const kn = k && c.net(p.id, k.id);
        const driven = an?.pins.some((x) => x.part.c.category === "mcu" || has(x.pin, "power_out"));
        return driven && kn?.isGround
          ? [
              finding(
                { id: "elec.led-resistor", severity: "warning" },
                `${p.id} is wired between a pin/supply and GND with nothing to limit its current.`,
                "Without a series resistor (220–330 Ω at 5 V) the LED and the pin are overloaded. LineLab has no resistor part yet, so add one on the real board.",
                [partRef(p)],
              ),
            ]
          : [];
      }),
  ),

  r("elec.sensor-unconnected", "warning", "Line sensor outputs not read", (c) =>
    partsOf(c, "line_sensor")
      .filter(() => mcuOf(c) !== undefined)
      .flatMap((s) => {
        const outs = s.c.pins.filter((p) => !isPowerPin(p) && !has(p, "enable"));
        const open = outs.filter(
          (p) => !c.net(s.id, p.id)?.pins.some((x) => x.part.c.category === "mcu"),
        );
        return open.length > 0
          ? [
              finding(
                { id: "elec.sensor-unconnected", severity: "warning" },
                `${open.length} of ${outs.length} outputs of ${s.id} are not connected to the microcontroller.`,
                "Unread channels leave blind spots in the array: the robot loses the line on sharp turns.",
                open.map((pin) => pinRef({ part: s, pin })),
              ),
            ]
          : [];
      }),
  ),

  r("elec.no-mcu", "warning", "No microcontroller", (c) =>
    c.parts.some((p) => ["motor_driver", "line_sensor"].includes(p.c.category)) && !mcuOf(c)
      ? [
          finding(
            { id: "elec.no-mcu", severity: "warning" },
            "The robot has sensors or drivers but no microcontroller.",
            "Something has to read the sensors and run the control loop. Add an MCU board such as an Arduino Nano or ESP32.",
            [{ kind: "design", ref: c.design.id }],
          ),
        ]
      : [],
  ),

  r("elec.no-battery", "warning", "No battery", (c) =>
    c.parts.some((p) => p.c.category === "motor") && partsOf(c, "battery").length === 0
      ? [
          finding(
            { id: "elec.no-battery", severity: "warning" },
            "The robot has motors but no battery.",
            "USB power can't drive motors. Add a battery pack (2S LiPo is the usual choice).",
            [{ kind: "design", ref: c.design.id }],
          ),
        ]
      : [],
  ),
];

export type { Pin };
