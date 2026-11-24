import type { SimEvent } from "@linelab/schema";
import { describe, expect, it } from "vitest";
import { TrackBuilder } from "../track/builder.js";
import { TrackField } from "../track/geometry.js";
import { TRACE_CHANNELS, type PackedTrace, type TraceChannel } from "../sim/simulation.js";
import {
  blockingDelay,
  controlLoopJitter,
  detect,
  dominantFrequency,
  infiniteLoop,
  integratorWindup,
  lineLost,
  missedTurn,
  oscillation,
  pwmSaturation,
  steeringInverted,
  wrongDirection,
  type DetectInput,
} from "./detectors.js";

const DT = 10;
type Row = Partial<Record<TraceChannel, number>>;

/** A packed trace from rows of channel values (tMs filled in at 10 ms steps). */
function traceOf(n: number, row: (i: number, tMs: number) => Row): PackedTrace {
  const stride = TRACE_CHANNELS.length;
  const data = new Float64Array(n * stride);
  for (let i = 0; i < n; i++) {
    const r: Row = { lineSeen: 3, ...row(i, i * DT), tMs: i * DT };
    TRACE_CHANNELS.forEach((c, k) => (data[i * stride + k] = r[c] ?? 0));
  }
  return { stride, count: n, sensorCount: 0, data };
}

const field = new TrackField(
  new TrackBuilder({ x: 0, y: 0, headingRad: 0 })
    .forward(600)
    .turn(90, 30)
    .forward(600)
    .build({ id: "track.t", name: "T" }, { x: 0, y: 0, headingRad: 0 }),
);
const input = (trace: PackedTrace, extra: Partial<DetectInput> = {}): DetectInput => ({
  trace,
  recordEveryMs: DT,
  field,
  simEvents: [],
  outcome: "finished",
  ...extra,
});
const types = (es: SimEvent[]) => es.map((e) => `${e.type}:${e.severity}`);

describe("line lost", () => {
  it("flags a recovered loss as a warning and an unrecovered one as an error", () => {
    const recovered = traceOf(100, (i) => ({ lineSeen: i >= 30 && i < 50 ? 0 : 3 }));
    expect(types(lineLost(input(recovered)))).toEqual([
      "line_lost:warning",
      "line_reacquired:info",
    ]);
    const lost = traceOf(100, (i) => ({ lineSeen: i >= 60 ? 0 : 3 }));
    expect(types(lineLost(input(lost, { outcome: "off_track" })))).toEqual(["line_lost:error"]);
    // Finishing an open course runs the sensors past the end of the line: not a failure.
    expect(lineLost(input(lost, { outcome: "finished" }))).toEqual([]);
  });
  it("ignores brief gaps (dashed lines)", () => {
    expect(lineLost(input(traceOf(100, (i) => ({ lineSeen: i >= 30 && i < 36 ? 0 : 3 }))))).toEqual(
      [],
    );
  });
});

describe("oscillation", () => {
  it("reports the frequency and blames P for fast and D for slow oscillation", () => {
    const fast = oscillation(
      input(traceOf(600, (_, t) => ({ lateralMm: 8 * Math.sin(2 * Math.PI * 6 * (t / 1000)) }))),
    );
    expect(fast[0]?.data).toMatchObject({ frequencyHz: 6, likely: "p_too_high" });
    const slow = oscillation(
      input(traceOf(600, (_, t) => ({ lateralMm: 12 * Math.sin(2 * Math.PI * 2 * (t / 1000)) }))),
    );
    expect(slow[0]?.data).toMatchObject({ frequencyHz: 2, likely: "d_too_low" });
  });
  it("stays quiet for small or slow errors", () => {
    expect(
      oscillation(
        input(
          traceOf(600, (_, t) => ({ lateralMm: 1.5 * Math.sin(2 * Math.PI * 6 * (t / 1000)) })),
        ),
      ),
    ).toEqual([]);
    expect(
      oscillation(
        input(
          traceOf(600, (_, t) => ({ lateralMm: 10 * Math.sin(2 * Math.PI * 0.3 * (t / 1000)) })),
        ),
      ),
    ).toEqual([]);
  });
  it("finds the dominant frequency", () => {
    expect(
      dominantFrequency(
        Array.from({ length: 500 }, (_, i) => Math.sin(2 * Math.PI * 3.3 * i * 0.01)),
        0.01,
      ),
    ).toBeCloseTo(3.3, 1);
  });
});

describe("PWM saturation", () => {
  it("flags a motor stuck at full duty", () => {
    expect(
      types(
        pwmSaturation(
          input(traceOf(200, (i) => ({ pwmLeft: i > 50 && i < 90 ? 1 : 0.5, pwmRight: 0.5 }))),
        ),
      ),
    ).toEqual(["pwm_saturation:warning"]);
  });
  it("allows brief full-power corrections", () => {
    expect(
      pwmSaturation(
        input(traceOf(200, (i) => ({ pwmLeft: i % 20 === 0 ? 1 : 0.6, pwmRight: 0.6 }))),
      ),
    ).toEqual([]);
  });
});

describe("missed turn", () => {
  it("names the turn where the robot left the line", () => {
    const tr = traceOf(100, (_, t) => ({ progressMm: (t / 1000) * 800 }));
    const ev = missedTurn(
      input(tr, { simEvents: [{ tMs: 800, type: "off_track", severity: "error", data: {} }] }),
    );
    expect(ev[0]).toMatchObject({ type: "missed_turn", data: { turnDeg: 90 } });
  });
  it("says nothing when the robot left on a straight", () => {
    const tr = traceOf(100, (_, t) => ({ progressMm: (t / 1000) * 300 }));
    expect(
      missedTurn(
        input(tr, { simEvents: [{ tMs: 600, type: "off_track", severity: "error", data: {} }] }),
      ),
    ).toEqual([]);
  });
});

describe("blocking delay, jitter, infinite loop", () => {
  const loc = { file: "a.ino", line: 42, exact: true };
  it("reports long blocking calls with their source line", () => {
    const ev = blockingDelay(
      input(
        traceOf(10, () => ({})),
        {
          longCalls: [
            { atMs: 100, durationMs: 30, loc },
            { atMs: 200, durationMs: 30, loc },
          ],
        },
      ),
    );
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      type: "blocking_delay",
      severity: "error",
      sourceLoc: loc,
      data: { count: 2 },
    });
    expect(
      blockingDelay(
        input(
          traceOf(10, () => ({})),
          {
            longCalls: [{ atMs: 100, durationMs: 2, loc }],
            sampleTimesMs: Array.from({ length: 50 }, (_, i) => i),
          },
        ),
      ),
    ).toEqual([]);
  });
  it("flags an irregular loop period but not a steady one", () => {
    const steady = Array.from({ length: 200 }, (_, i) => i * 1.5);
    expect(
      controlLoopJitter(
        input(
          traceOf(10, () => ({})),
          { sampleTimesMs: steady },
        ),
      ),
    ).toEqual([]);
    let t = 0;
    const irregular = Array.from({ length: 200 }, (_, i) => (t += i % 3 === 0 ? 5 : 1));
    expect(
      types(
        controlLoopJitter(
          input(
            traceOf(10, () => ({})),
            { sampleTimesMs: irregular },
          ),
        ),
      ),
    ).toEqual(["control_loop_jitter:warning"]);
  });
  it("flags a stall and points at the line", () => {
    expect(
      infiniteLoop(
        input(
          traceOf(10, () => ({})),
          { stalls: [{ atMs: 500, durationMs: 900, loc }] },
        ),
      )[0],
    ).toMatchObject({ type: "infinite_loop", sourceLoc: loc });
    expect(
      infiniteLoop(
        input(
          traceOf(10, () => ({})),
          { stalls: [{ atMs: 500, durationMs: 50, loc }] },
        ),
      ),
    ).toEqual([]);
  });
});

describe("integrator windup", () => {
  it("flags an integral that grows without bound, not one that stays bounded", () => {
    const grows = { names: ["integral"], samples: [Array.from({ length: 300 }, (_, i) => i * i)] };
    expect(
      types(
        integratorWindup(
          input(
            traceOf(10, () => ({})),
            { watch: grows },
          ),
        ),
      ),
    ).toEqual(["integrator_windup:warning"]);
    const bounded = {
      names: ["integral"],
      samples: [Array.from({ length: 300 }, (_, i) => Math.min(i * i, 2000))],
    };
    expect(
      integratorWindup(
        input(
          traceOf(10, () => ({})),
          { watch: bounded },
        ),
      ),
    ).toEqual([]);
  });
});

describe("wrong direction and inverted steering", () => {
  it("flags one wheel running backwards while the robot spins in place", () => {
    const ev = wrongDirection(
      input(traceOf(200, () => ({ wheelLeftRadS: 30, wheelRightRadS: -30, progressMm: 10 }))),
    );
    expect(ev[0]).toMatchObject({ type: "wrong_direction", data: { wheel: "right" } });
  });
  it("flags opposite motor commands at the start, while the robot is straight on the line", () => {
    const ev = wrongDirection(
      input(traceOf(100, (i) => (i < 3 ? {} : { pwmLeft: 0.45, pwmRight: -0.45, lateralMm: i }))),
    );
    expect(ev[0]).toMatchObject({
      type: "wrong_direction",
      data: { wheel: "right", atStart: true },
    });
    expect(
      wrongDirection(input(traceOf(100, () => ({ pwmLeft: 0.45, pwmRight: 0.4, lateralMm: 1 })))),
    ).toEqual([]);
    // A controller that later pivots (one wheel back) after starting forwards is fine.
    expect(
      wrongDirection(
        input(
          traceOf(100, (i) => ({
            pwmLeft: 0.45,
            pwmRight: i < 5 ? 0.45 : -0.3,
            progressMm: i * 5,
          })),
        ),
      ),
    ).toEqual([]);
  });
  it("allows short pivot turns", () => {
    expect(
      wrongDirection(
        input(
          traceOf(200, (i) => ({
            wheelLeftRadS: 30,
            wheelRightRadS: i % 50 < 20 ? -10 : 30,
            progressMm: i * 5,
          })),
        ),
      ),
    ).toEqual([]);
  });
  it("flags steering away from the line", () => {
    const away = traceOf(150, (i) => ({ lateralMm: i / 2, omegaRadS: i / 20 }));
    expect(
      types(
        steeringInverted(
          input(away, {
            simEvents: [{ tMs: 1500, type: "off_track", severity: "error", data: {} }],
          }),
        ),
      ),
    ).toEqual(["steering_inverted:error"]);
    const towards = traceOf(150, (i) => ({
      lateralMm: Math.sin(i / 10) * 5,
      omegaRadS: -Math.sin(i / 10),
    }));
    expect(
      steeringInverted(
        input(towards, {
          simEvents: [{ tMs: 1500, type: "off_track", severity: "error", data: {} }],
        }),
      ),
    ).toEqual([]);
  });
});

describe("detect()", () => {
  it("passes simulator events through with an explanation, sorted by time", () => {
    const ev = detect(
      input(
        traceOf(50, () => ({})),
        {
          simEvents: [
            { tMs: 400, type: "lap_complete", severity: "info", data: { lap: 1 } },
            { tMs: 100, type: "brownout", severity: "error", data: {} },
          ],
        },
      ),
    );
    expect(ev.map((e) => e.type)).toEqual(["brownout", "lap_complete"]);
    expect(ev[0]?.message).toMatch(/battery voltage sagged/);
  });
});
