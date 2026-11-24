import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getChassis, getComponent } from "@linelab/component-db";
import { resolveChassis } from "@linelab/design-core";
import { Design, FirmwareArtifact, Track } from "@linelab/schema";
import { buildRobotModel } from "@linelab/sim-core";
import { describe, expect, it } from "vitest";
import { AvrMcu } from "./avr.js";
import { DRIVER_CHANNELS, channelDuty } from "./drivers.js";
import { parseIntelHex } from "./hex.js";
import { runFirmware } from "./index.js";
import { motorCommand, resolveWiring } from "./wiring.js";

const repo = join(import.meta.dirname, "..", "..", "..");
const json = (p: string): unknown => JSON.parse(readFileSync(join(repo, p), "utf8"));
const artifact = (name: string, board: string) =>
  FirmwareArtifact.parse(json(`examples/firmware/${name}/${name}.${board}.artifact.json`));
const design = (f: string) => Design.parse(json(`packages/sim-core/fixtures/${f}`));
const track = (id: string) => Track.parse(json(`tracks/track.${id}.json`));
const robotOf = (d: Design) => {
  const c = resolveChassis(d, getChassis);
  if (!c) throw new Error("chassis");
  return buildRobotModel(d, c, getComponent);
};

describe("Intel HEX", () => {
  it("parses data records and rejects bad checksums", () => {
    const flash = parseIntelHex(":0400000001020304F2\n:00000001FF\n", 16);
    expect([...flash.subarray(0, 5)]).toEqual([1, 2, 3, 4, 0]);
    expect(() => parseIntelHex(":0400000001020304F3\n", 16)).toThrow(/checksum/);
  });
});

describe("emulated ATmega328P", () => {
  it("blink.ino toggles D13 every 500 ms within 1 %", () => {
    const mcu = new AvrMcu(artifact("blink", "nano").hex ?? "", { clockHz: 16e6, avccV: 5 });
    const toggles: number[] = [];
    let last = mcu.outputLevel("D13");
    const step = 160; // 10 µs
    for (let i = 0; i < 3.2e6 / 10 / 1; i += 1) {
      mcu.run(step);
      const now = mcu.outputLevel("D13");
      if (now !== last) toggles.push(mcu.timeMs);
      last = now;
      if (mcu.timeMs > 3200) break;
    }
    expect(toggles.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < toggles.length; i++) {
      const dt = (toggles[i] ?? 0) - (toggles[i - 1] ?? 0);
      expect(Math.abs(dt - 500) / 500).toBeLessThan(0.01);
    }
  }, 30_000);

  it("reads PWM duty from timer registers (analogWrite) and serial output", () => {
    const ref = design("reference.design.json");
    const robot = robotOf(ref);
    const r = runFirmware({
      design: ref,
      lookup: getComponent,
      robot,
      track: track("oval"),
      artifact: artifact("good_pid", "nano"),
      config: { durationMs: 600 },
    });
    expect(r.serial).toContain("good_pid ready");
    expect(r.serial).toMatch(/err -?\d+/);
  });
});

describe("wiring", () => {
  const ref = design("reference.design.json");
  const robot = robotOf(ref);

  it("maps the reference robot: motor A = left, B = right, sensors on A0..A7, STBY tied high", () => {
    const w = resolveWiring(ref, getComponent, robot);
    expect(w.problems).toEqual([]);
    expect(w.motors.map((m) => [m.side, m.channel.out[0], m.polarity, m.inputs.STBY])).toEqual([
      ["left", "AO1", 1, { kind: "const", level: 1 }],
      ["right", "BO1", 1, { kind: "const", level: 1 }],
    ]);
    expect(w.sensors.map((s) => s.mcuPin)).toEqual([
      "A0",
      "A1",
      "A2",
      "A3",
      "A4",
      "A5",
      "A6",
      "A7",
    ]);
    const levels: Record<string, number> = { D3: 0.5, D2: 1, D4: 0, D5: 0.25, D7: 0, D8: 1 };
    expect(motorCommand(w, (p) => levels[p])).toEqual({ left: 0.5, right: -0.25 });
  });

  it("swapped motor wires reverse that motor; a floating STBY stops both", () => {
    const swapped = {
      ...ref,
      netlist: ref.netlist.map((n) => ({
        ...n,
        connections: n.connections.map((c) =>
          c.instanceId === "motor1" ? { ...c, pinId: c.pinId === "M+" ? "M-" : "M+" } : c,
        ),
      })),
    };
    expect(resolveWiring(swapped, getComponent, robot).motors[0]?.polarity).toBe(-1);
    const noStby = {
      ...ref,
      netlist: ref.netlist.map((n) => ({
        ...n,
        connections: n.connections.filter((c) => c.pinId !== "STBY"),
      })),
    };
    const w = resolveWiring(noStby, getComponent, robot);
    expect(w.problems.join(" ")).toMatch(/STBY isn't connected/);
    expect(motorCommand(w, () => 1)).toEqual({ left: 0, right: 0 });
  });
});

describe("driver logic", () => {
  const ch = (id: string, i = 0) => {
    const c = DRIVER_CHANNELS[id]?.[i];
    if (!c) throw new Error(id);
    return c;
  };
  it.each([
    ["driver.tb6612fng", { PWMA: 0.6, AIN1: 1, AIN2: 0, STBY: 1 }, 0.6],
    ["driver.tb6612fng", { PWMA: 0.6, AIN1: 0, AIN2: 1, STBY: 1 }, -0.6],
    ["driver.tb6612fng", { PWMA: 0.6, AIN1: 1, AIN2: 1, STBY: 1 }, 0],
    ["driver.tb6612fng", { PWMA: 0.6, AIN1: 1, AIN2: 0, STBY: 0 }, 0],
    ["driver.drv8833-pololu", { AIN1: 0.7, AIN2: 0, SLP: 1 }, 0.7],
    ["driver.drv8833-pololu", { AIN1: 1, AIN2: 0.3, SLP: 1 }, 0.7],
    ["driver.max14870-pololu", { PWM: 0.4, DIR: 1, EN: 0 }, -0.4],
    ["driver.max14870-pololu", { PWM: 0.4, DIR: 0, EN: 1 }, 0],
    ["driver.l298n-module", { ENA: 1, IN1: 0, IN2: 1 }, -1],
  ] as const)("%s %o → %d", (id, levels, expected) => {
    expect(channelDuty(ch(id), (p) => (levels as Record<string, number>)[p] ?? 0)).toBeCloseTo(
      expected,
    );
  });
  it("DRV8835 switches between IN/IN and PHASE/ENABLE with MODE", () => {
    const c = ch("driver.drv8835-pololu");
    expect(channelDuty(c, (p) => ({ AIN1: 0.5, AIN2: 0, MODE: 0 })[p] ?? 0)).toBeCloseTo(0.5);
    expect(channelDuty(c, (p) => ({ AIN1: 1, AIN2: 0.5, MODE: 1 })[p] ?? 0)).toBeCloseTo(-0.5);
  });
});

describe("firmware on the robot", () => {
  const ref = design("reference.design.json");
  const robot = robotOf(ref);

  it.each(["oval", "figure-eight"])(
    "good_pid.ino on an emulated Nano completes the %s",
    (id) => {
      const r = runFirmware({
        design: ref,
        lookup: getComponent,
        robot,
        track: track(id),
        artifact: artifact("good_pid", "nano"),
        profile: true,
      });
      expect(r.result.outcome).toBe("finished");
      expect(r.result.metrics.meanLateralErrorMm).toBeLessThan(15);
      // ~1.1 ms per loop: 8 analogReads at ~112 µs each plus the PID maths.
      expect(r.loop?.medianMs).toBeGreaterThan(0.8);
      expect(r.loop?.medianMs).toBeLessThan(2);
      // The profiler maps samples back to the sketch and the core (analogRead's busy wait).
      // analogRead's busy wait dominates (8 conversions × 104 µs per loop).
      expect(r.hotFiles?.[0]?.file).toBe("wiring_analog.c");
      expect(r.hotFiles?.find((f) => f.file === "good_pid.ino")?.share).toBeGreaterThan(0.01);
      // Typed from DWARF: lastError is a long, lo/hi are ints holding the calibration.
      expect(Number.isInteger(r.watch?.lastError)).toBe(true);
      expect(Math.abs(r.watch?.lastError ?? NaN)).toBeLessThanOrEqual(3500);
      expect(r.watch?.lo).toBeLessThan(300);
      expect(r.watch?.hi).toBeGreaterThan(700);
    },
    60_000,
  );

  it("esp32_pid.ino runs on the HAL tier and completes the oval", () => {
    const esp = design("esp32.design.json");
    const r = runFirmware({
      design: esp,
      lookup: getComponent,
      robot: robotOf(esp),
      track: track("oval"),
      artifact: artifact("esp32_pid", "esp32"),
    });
    expect(r.wiring.problems).toEqual([]);
    expect(r.serial).toContain("esp32_pid ready");
    expect(r.result.outcome).toBe("finished");
    expect(r.loop?.medianMs).toBeGreaterThan(1); // delay(1) + 8 × analogRead
  }, 60_000);

  it("is deterministic: the same firmware and seed give the same trace", () => {
    const run = () =>
      runFirmware({
        design: ref,
        lookup: getComponent,
        robot,
        track: track("oval"),
        artifact: artifact("good_pid", "nano"),
        config: { durationMs: 1500, seed: 3 },
      }).result.hash;
    expect(run()).toBe(run());
  }, 60_000);
});
