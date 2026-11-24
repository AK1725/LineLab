// End-to-end check of the Arduino library: compile output of examples/firmware/telemetry_pid
// (the real LineLabTelemetry.cpp, built by arduino-cli for the Nano) runs on the emulated
// ATmega328P in the simulator; its UART bytes are decoded with the TS codec and compared with
// what the simulator fed the firmware.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getChassis, getComponent } from "@linelab/component-db";
import { resolveChassis } from "@linelab/design-core";
import { runFirmware } from "@linelab/firmware-runtime";
import { Design, FirmwareArtifact, TelemetryRecording, Track } from "@linelab/schema";
import { TRACE_CHANNELS, buildRobotModel, column } from "@linelab/sim-core";
import { describe, expect, it } from "vitest";
import { bytesOfLatin1, decodeRecording } from "./recording.js";

const repo = join(import.meta.dirname, "..", "..", "..");
const json = (p: string): unknown => JSON.parse(readFileSync(join(repo, p), "utf8"));

describe("LineLabTelemetry on the emulated Nano", () => {
  const design = Design.parse(json("packages/sim-core/fixtures/reference.design.json"));
  const chassis = resolveChassis(design, getChassis);
  if (!chassis) throw new Error("chassis");
  const robot = buildRobotModel(design, chassis, getComponent);
  const run = runFirmware({
    design,
    lookup: getComponent,
    robot,
    track: Track.parse(json("tracks/track.oval.json")),
    artifact: FirmwareArtifact.parse(
      json("examples/firmware/telemetry_pid/telemetry_pid.nano.artifact.json"),
    ),
    config: { durationMs: 2000 },
  });
  const { recording, badFrames } = decodeRecording(bytesOfLatin1(run.serial), "simulated");

  it("streams a hello frame and CRC-valid samples every 10 ms", () => {
    expect(badFrames).toBe(0);
    expect(TelemetryRecording.safeParse(recording).success).toBe(true);
    expect(recording).toMatchObject({ name: "telemetry_pid", sensorCount: 8, periodMs: 10 });
    // ~2 s at 10 ms; the first ~100 ms is the bootloader-free reset + setup.
    expect(recording.samples.length).toBeGreaterThan(180);
    expect(recording.samples.length).toBeLessThan(202);
    const dts = recording.samples.slice(1).map((s, i) => s.tMs - (recording.samples[i]?.tMs ?? 0));
    const mean = dts.reduce((a, b) => a + b, 0) / dts.length;
    expect(mean).toBeGreaterThan(9.5);
    expect(mean).toBeLessThan(10.6);
  });

  it("reports the sensor values and motor commands the firmware actually used", () => {
    const tr = run.result.trace;
    const t = column(tr, "tMs");
    const pl = column(tr, "pwmLeft");
    const pr = column(tr, "pwmRight");
    const s0 = TRACE_CHANNELS.length;
    // Telemetry samples that were sent just before a trace row (within one control loop, so
    // the firmware hasn't updated its outputs yet): the motor command they report is what the
    // simulator read from the timer registers, and the sensor values are what the emulated ADC
    // returned a millisecond earlier.
    let compared = 0;
    let sensorErr = 0;
    for (const s of recording.samples.slice(5)) {
      const i = t.findIndex((x) => x >= s.tMs);
      if (i < 0 || (t[i] ?? 0) - s.tMs > 0.8) continue;
      expect(Math.abs((pl[i] ?? 0) - s.pwmLeft)).toBeLessThan(0.01);
      expect(Math.abs((pr[i] ?? 0) - s.pwmRight)).toBeLessThan(0.01);
      for (let c = 0; c < 8; c++)
        sensorErr += Math.abs((tr.data[i * tr.stride + s0 + c] ?? 0) - (s.sensors[c] ?? 0));
      compared++;
    }
    expect(compared).toBeGreaterThanOrEqual(8); // deterministic run: 11 such samples
    expect(sensorErr / (compared * 8)).toBeLessThan(15); // measured ≈ 6.7 counts
    expect(recording.samples.every((s) => s.sensors.every((v) => v <= 1023))).toBe(true);
    // The PID error is reported as a variable, within the sketch's ±3500 range.
    expect(recording.samples.every((s) => s.vars.length === 1)).toBe(true);
    expect(recording.samples.every((s) => Math.abs(s.vars[0] ?? 0) <= 3500)).toBe(true);
  });
});
