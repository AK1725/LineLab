import type { Component, ElectricalSpec, Range } from "@linelab/schema";

const num = (n: number, digits = 2) => Number(n.toFixed(digits)).toString();
const range = (r: Range, unit: string) =>
  r.min === r.max ? `${num(r.min)} ${unit}` : `${num(r.min)}–${num(r.max)} ${unit}`;

export type SpecRow = readonly [label: string, value: string];

/** Human-readable rows for a component's electrical/mechanical spec. */
export function specRows(e: ElectricalSpec): SpecRow[] {
  switch (e.kind) {
    case "mcu":
      return [
        ["Architecture", e.arch],
        ["Logic level", `${num(e.logicVoltageV)} V`],
        ["Input voltage", range(e.inputVoltage, "V")],
        ["Clock", `${num(e.clockMHz)} MHz`],
        ["Flash", `${num(e.flashKB)} KB`],
        ["SRAM", `${num(e.sramKB)} KB`],
        ["ADC resolution", `${e.adcBits} bit`],
        ["All I/O 5 V tolerant", e.fiveVoltTolerantIO ? "Yes" : "No"],
        ...(e.fqbn ? ([["Board id (FQBN)", e.fqbn]] as SpecRow[]) : []),
      ];
    case "line_sensor":
      return [
        ["Channels", String(e.channels)],
        ["Output", e.outputType === "rc" ? "RC (timed)" : e.outputType],
        ...(e.channels > 1
          ? ([["Channel pitch", `${num(e.channelPitchMm, 3)} mm`]] as SpecRow[])
          : []),
        ["Optimal height", range(e.optimalHeightMm, "mm")],
        ["Supply", range(e.supplyVoltage, "V")],
        ["Max current", `${num(e.maxCurrentmA)} mA`],
      ];
    case "motor_driver":
      return [
        ["Channels", String(e.channels)],
        ["Motor voltage", range(e.motorVoltage, "V")],
        ["Logic voltage", range(e.logicVoltage, "V")],
        ["Continuous / channel", `${num(e.continuousCurrentPerChannelA)} A`],
        ["Peak / channel", `${num(e.peakCurrentPerChannelA)} A`],
        ["Voltage drop", `≈ ${num(e.voltageDropV)} V`],
        ...(e.maxPwmFrequencyKHz
          ? ([["Max PWM", `${num(e.maxPwmFrequencyKHz)} kHz`]] as SpecRow[])
          : []),
      ];
    case "motor":
      return [
        ["Rated voltage", `${num(e.ratedVoltageV)} V`],
        ["No-load speed", `${num(e.noLoadRpm, 0)} RPM`],
        ["Gear ratio", `${num(e.gearRatio)}:1`],
        ["Stall torque", `${num(e.stallTorqueKgCm, 3)} kg·cm`],
        ["Stall current", `${num(e.stallCurrentA)} A`],
        ["No-load current", `${num(e.noLoadCurrentA)} A`],
      ];
    case "battery":
      return [
        ["Chemistry", e.chemistry],
        ["Cells in series", `${e.cellsInSeries}S`],
        [
          "Voltage",
          `${num(e.nominalVoltageV)} V nominal (${num(e.cutoffVoltageV)}–${num(e.fullVoltageV)} V)`,
        ],
        ["Capacity", `${num(e.capacitymAh, 0)} mAh`],
        ["Max continuous", `${num(e.maxContinuousDischargeA)} A`],
        ["Internal resistance", `≈ ${num(e.internalResistanceMilliohm, 0)} mΩ`],
      ];
    case "regulator":
      return [
        ["Topology", e.topology],
        ["Input", range(e.inputVoltage, "V")],
        ["Output", range(e.outputVoltage, "V")],
        ["Max output current", `${num(e.maxOutputCurrentA)} A`],
        ...(e.dropoutV !== undefined ? ([["Dropout", `${num(e.dropoutV)} V`]] as SpecRow[]) : []),
        ...(e.efficiencyPct !== undefined
          ? ([["Efficiency", `up to ${num(e.efficiencyPct, 0)} %`]] as SpecRow[])
          : []),
      ];
    case "wheel":
      return [
        ["Diameter", `${num(e.diameterMm)} mm`],
        ["Width", `${num(e.widthMm)} mm`],
        ...(e.frictionCoefficient !== undefined
          ? ([["Friction (nominal)", `μ ≈ ${num(e.frictionCoefficient)}`]] as SpecRow[])
          : []),
      ];
    case "generic":
      return [
        ...(e.supplyVoltage ? ([["Supply", range(e.supplyVoltage, "V")]] as SpecRow[]) : []),
        ...(e.maxCurrentmA !== undefined
          ? ([["Max current", `${num(e.maxCurrentmA)} mA`]] as SpecRow[])
          : []),
      ];
  }
}

/** One-line summary for result cards. */
export function summary(c: Component): string {
  const e = c.electrical;
  switch (e.kind) {
    case "mcu":
      return `${num(e.logicVoltageV)} V · ${num(e.clockMHz)} MHz · ${num(e.flashKB)} KB flash`;
    case "line_sensor":
      return `${e.channels} ch · ${e.outputType === "rc" ? "RC" : e.outputType}`;
    case "motor_driver":
      return `${e.channels} ch · ${range(e.motorVoltage, "V")} · ${num(e.continuousCurrentPerChannelA)} A`;
    case "motor":
      return `${num(e.ratedVoltageV)} V · ${num(e.noLoadRpm, 0)} RPM`;
    case "battery":
      return `${e.cellsInSeries}S · ${num(e.nominalVoltageV)} V · ${num(e.capacitymAh, 0)} mAh`;
    case "regulator":
      return `${e.topology} · ${range(e.outputVoltage, "V")} · ${num(e.maxOutputCurrentA)} A`;
    case "wheel":
      return `${num(e.diameterMm)} × ${num(e.widthMm)} mm`;
    case "generic":
      return `${num(c.dimensionsMm.x)} × ${num(c.dimensionsMm.y)} × ${num(c.dimensionsMm.z)} mm`;
  }
}
