"use client";

import { TWIN_PARAMS } from "@linelab/calibrate";
import hiddenTwin from "@linelab/calibrate/fixtures/hidden-twin.recording.json";
import { TRACKS } from "@linelab/component-db";
import { TelemetryRecording, type Board, type Track } from "@linelab/schema";
import { useEffect, useMemo, useState } from "react";
import { useDesign, useEditor } from "../editor/store";
import { boardOf, useFirmware } from "../firmware/store";
import { useRun } from "../sim/run-store";
import { listTracks } from "../tracks/storage";
import { bluetoothApi, serialApi } from "./link";
import { useRobot, type LiveSample } from "./robot-store";

/** Boards the browser flasher can program (ATmega328P + STK500 bootloader). */
const STK500_BOARDS: Partial<Record<Board, { bauds: number[]; note: string }>> = {
  "arduino:avr:uno": { bauds: [115200], note: "Optiboot, 115200 baud" },
  "arduino:avr:nano": {
    bauds: [115200, 57600],
    note: "New bootloader 115200; boards sold as 'old bootloader' use 57600",
  },
  "arduino:avr:pro": { bauds: [57600], note: "ATmegaBOOT, 57600 baud (5 V / 16 MHz)" },
};
const COMING_SOON: [RegExp, string][] = [
  [/^esp32:/, "ESP32 flashing (esptool-js) is coming soon. Use the Arduino IDE for now."],
  [/^rp2040:/, "RP2040 UF2 download is coming soon. Use the Arduino IDE for now."],
  [/^stm32:/, "STM32 flashing is coming soon. Use the Arduino IDE or STM32CubeProgrammer."],
];

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-2 rounded-lg border border-border p-3">
    <h2 className="text-sm font-semibold">{title}</h2>
    {children}
  </section>
);

const btn =
  "rounded-md border border-border px-3 py-1 text-sm hover:bg-card disabled:cursor-not-allowed disabled:opacity-50";
const primary =
  "rounded-md bg-accent px-3 py-1 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 dark:text-black";

function Connect() {
  const link = useRobot((s) => s.link);
  const connecting = useRobot((s) => s.connecting);
  const error = useRobot((s) => s.error);
  const stats = useRobot((s) => s.stats);
  const hello = useRobot((s) => s.hello);
  const [baud, setBaud] = useState(115200);
  // Client-only component (loaded with ssr: false), so navigator is there.
  const hasSerial = serialApi() !== undefined;
  const hasBle = bluetoothApi() !== undefined;
  return (
    <Section title="Connect">
      {!hasSerial && !hasBle && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          This browser has neither Web Serial nor Web Bluetooth. Use Chrome or Edge on a desktop
          (Bluetooth also works in Chrome on Android).
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1">
          <span className="text-muted">Baud</span>
          <select
            aria-label="Baud rate"
            value={baud}
            onChange={(e) => {
              setBaud(Number(e.target.value));
            }}
            className="rounded-md border border-border bg-bg px-1 py-1"
          >
            {[9600, 57600, 115200, 230400, 250000, 500000, 1000000].map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <button
          className={primary}
          disabled={!hasSerial || connecting}
          onClick={() => void useRobot.getState().connect("serial", baud)}
        >
          USB serial…
        </button>
        <button
          className={btn}
          disabled={!hasBle || connecting}
          onClick={() => void useRobot.getState().connect("ble", baud)}
        >
          Bluetooth…
        </button>
        {link && (
          <button className={btn} onClick={() => void useRobot.getState().disconnect()}>
            Disconnect
          </button>
        )}
      </div>
      <p className="text-xs text-muted" aria-live="polite">
        {link
          ? `Connected: ${link.label}. ${hello ? `Sketch "${hello.name}", ${hello.sensorCount} sensors every ${hello.periodMs} ms. ` : ""}${stats.samples} samples, ${stats.badFrames} bad frames, ${stats.bytes} bytes.`
          : connecting
            ? "Connecting…"
            : "Not connected."}
      </p>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <p className="text-xs text-muted">
        Your sketch needs the <code>LineLabTelemetry</code> library (see the{" "}
        <code>telemetry_pid</code> example). Bluetooth: Nordic UART (ESP32, nRF) or HM-10 modules.
      </p>
    </Section>
  );
}

function Flash() {
  const design = useDesign();
  const board = boardOf(design);
  const artifact = useFirmware((s) => s.artifact);
  const fwDesign = useFirmware((s) => s.designId);
  const link = useRobot((s) => s.link);
  const flash = useRobot((s) => s.flash);
  const spec = board ? STK500_BOARDS[board.board] : undefined;
  const [baud, setBaud] = useState<number | undefined>(undefined);
  const bootBaud = baud ?? spec?.bauds[0] ?? 115200;
  const ready =
    artifact !== null &&
    fwDesign === design.id &&
    artifact.board === board?.board &&
    !!artifact.hex;
  const soon = board ? COMING_SOON.find(([re]) => re.test(board.board))?.[1] : undefined;
  return (
    <Section title="Flash firmware">
      {!board ? (
        <p className="text-xs text-muted">Add a microcontroller to the design first.</p>
      ) : !spec ? (
        <p className="text-xs text-muted">
          {soon ?? `Flashing ${board.name} from the browser is coming soon.`}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>{board.name}</span>
            <label className="flex items-center gap-1">
              <span className="text-muted">Bootloader</span>
              <select
                aria-label="Bootloader baud"
                value={bootBaud}
                onChange={(e) => {
                  setBaud(Number(e.target.value));
                }}
                className="rounded-md border border-border bg-bg px-1 py-1"
              >
                {spec.bauds.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={primary}
              disabled={!ready || link?.kind !== "serial" || flash.status === "flashing"}
              onClick={() => {
                if (artifact) void useRobot.getState().flashFirmware(artifact, bootBaud);
              }}
            >
              Flash
            </button>
          </div>
          <p className="text-xs text-muted">
            {spec.note}.{" "}
            {!ready
              ? "Compile the sketch in the Code tab first."
              : link?.kind !== "serial"
                ? "Connect over USB serial first."
                : "Writes the compiled sketch and reads it back to verify."}
          </p>
          {flash.status === "flashing" && flash.progress && (
            <p className="text-xs" aria-live="polite">
              {flash.progress.phase === "write" || flash.progress.phase === "verify"
                ? `${flash.progress.phase === "write" ? "Writing" : "Verifying"} page ${flash.progress.done} of ${flash.progress.total}…`
                : `${flash.progress.phase === "reset" ? "Resetting the board" : flash.progress.phase === "sync" ? "Waiting for the bootloader" : "Checking the chip"}…`}
            </p>
          )}
          {flash.status === "done" && <p className="text-xs text-accent">{flash.message}</p>}
          {flash.status === "error" && (
            <p className="text-xs text-red-600 dark:text-red-400">
              {flash.message} {flash.hint}
            </p>
          )}
        </>
      )}
    </Section>
  );
}

const SENSOR_W = 260;
const PLOT_W = 520;
const PLOT_H = 70;

function polyline(samples: LiveSample[], get: (s: LiveSample) => number, lo: number, hi: number) {
  if (samples.length < 2) return "";
  const t0 = samples[0]?.tMs ?? 0;
  const span = Math.max(1, (samples.at(-1)?.tMs ?? 0) - t0);
  return samples
    .map(
      (s) =>
        `${(((s.tMs - t0) / span) * PLOT_W).toFixed(1)},${(PLOT_H - ((get(s) - lo) / (hi - lo)) * PLOT_H).toFixed(1)}`,
    )
    .join(" ");
}

function Live() {
  const live = useRobot((s) => s.live);
  const log = useRobot((s) => s.log);
  const recording = useRobot((s) => s.recordingActive);
  const link = useRobot((s) => s.link);
  const last = live.at(-1);
  const view = live.slice(-500);
  const adcMax = Math.max(1023, ...(last?.sensors ?? []));
  const nVars = last?.vars.length ?? 0;
  const varRange = useMemo(() => {
    const xs = view.flatMap((s) => s.vars);
    const lo = Math.min(...xs, 0);
    const hi = Math.max(...xs, 0);
    return hi > lo ? ([lo, hi] as const) : ([lo - 1, hi + 1] as const);
  }, [view]);
  return (
    <Section title="Live telemetry">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {recording ? (
          <button
            className={primary}
            onClick={() => {
              useRobot.getState().stopRecording();
            }}
          >
            Stop recording
          </button>
        ) : (
          <button
            className={btn}
            disabled={!link}
            onClick={() => {
              useRobot.getState().startRecording();
            }}
          >
            Record
          </button>
        )}
        {recording && <span className="text-xs text-red-600 dark:text-red-400">● recording</span>}
      </div>
      {!last ? (
        <p className="text-xs text-muted">No samples yet.</p>
      ) : (
        <div className="space-y-2" data-testid="live-telemetry">
          <figure>
            <figcaption className="text-xs text-muted">
              Sensors (raw) {last.lineLost ? "· line lost" : ""}
            </figcaption>
            <svg
              viewBox={`0 0 ${SENSOR_W} 60`}
              className="h-16 w-full max-w-xs"
              role="img"
              aria-label="Sensor readings"
            >
              {last.sensors.map((v, i) => {
                const w = SENSOR_W / last.sensors.length;
                const h = (v / adcMax) * 58;
                return (
                  <rect
                    key={i}
                    x={i * w + 2}
                    y={60 - h}
                    width={w - 4}
                    height={h}
                    className="fill-accent"
                  />
                );
              })}
            </svg>
          </figure>
          <figure>
            <figcaption className="flex gap-2 text-xs">
              <span className="font-medium">Motor command</span>
              <span className="text-muted">−1 to 1</span>
              <span style={{ color: "#2563eb" }}>left {last.pwmLeft.toFixed(2)}</span>
              <span style={{ color: "#dc2626" }}>right {last.pwmRight.toFixed(2)}</span>
            </figcaption>
            <svg
              viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
              className="h-20 w-full"
              preserveAspectRatio="none"
              role="img"
              aria-label="Motor command plot"
            >
              <line x1={0} x2={PLOT_W} y1={PLOT_H / 2} y2={PLOT_H / 2} className="stroke-border" />
              <polyline
                fill="none"
                stroke="#2563eb"
                strokeWidth={1.5}
                points={polyline(view, (s) => s.pwmLeft, -1, 1)}
              />
              <polyline
                fill="none"
                stroke="#dc2626"
                strokeWidth={1.5}
                points={polyline(view, (s) => s.pwmRight, -1, 1)}
              />
            </svg>
          </figure>
          {nVars > 0 && (
            <figure>
              <figcaption className="text-xs">
                <span className="font-medium">Variables</span>{" "}
                <span className="text-muted">{last.vars.map((v) => v.toFixed(2)).join(", ")}</span>
              </figcaption>
              <svg
                viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
                className="h-20 w-full"
                preserveAspectRatio="none"
                role="img"
                aria-label="Variables plot"
              >
                {Array.from({ length: nVars }, (_, k) => (
                  <polyline
                    key={k}
                    fill="none"
                    stroke={["#16a34a", "#9333ea", "#ea580c", "#0891b2"][k] ?? "#888"}
                    strokeWidth={1.5}
                    points={polyline(view, (s) => s.vars[k] ?? 0, varRange[0], varRange[1])}
                  />
                ))}
              </svg>
            </figure>
          )}
          {last.batteryV !== undefined && (
            <p className="text-xs">Battery {last.batteryV.toFixed(2)} V</p>
          )}
        </div>
      )}
      {log.length > 0 && (
        <pre className="max-h-24 overflow-auto rounded bg-card p-2 text-xs">
          {log.slice(-20).join("\n")}
        </pre>
      )}
    </Section>
  );
}

function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function RecordingPanel() {
  const rec = useRobot((s) => s.recording);
  const [err, setErr] = useState<string | null>(null);
  const span = rec ? ((rec.samples.at(-1)?.tMs ?? 0) - (rec.samples[0]?.tMs ?? 0)) / 1000 : 0;
  return (
    <Section title="Recording">
      {rec ? (
        <p className="text-sm" data-testid="recording-summary">
          <span className="font-medium">{rec.name}</span>: {rec.samples.length} samples,{" "}
          {span.toFixed(1)} s.{" "}
          {rec.source !== "real" && (
            <span className="rounded bg-amber-500/15 px-1 text-xs text-amber-700 dark:text-amber-400">
              {rec.source === "synthetic" ? "Synthetic, not real robot data" : "Simulated"}
            </span>
          )}
        </p>
      ) : (
        <p className="text-xs text-muted">Record a run above, or load a saved recording.</p>
      )}
      <div className="flex flex-wrap gap-2 text-sm">
        <label className={btn}>
          Load…
          <input
            type="file"
            accept=".json,application/json"
            className="sr-only"
            aria-label="Load recording"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              void f.text().then((t) => {
                try {
                  useRobot.getState().loadRecording(t);
                  setErr(null);
                } catch (x) {
                  setErr(x instanceof Error ? x.message : String(x));
                }
              });
            }}
          />
        </label>
        <button
          className={btn}
          disabled={!rec}
          onClick={() => {
            if (rec)
              download(`${rec.name.replace(/\W+/g, "_")}.recording.json`, JSON.stringify(rec));
          }}
        >
          Download recording
        </button>
        <button
          className={btn}
          onClick={() => {
            useRobot.getState().setRecording(TelemetryRecording.parse(hiddenTwin));
          }}
        >
          Load synthetic demo
        </button>
      </div>
      <p className="text-xs text-muted">
        The synthetic demo is the simulator driving a robot with hidden parameters on the oval, for
        trying calibration without hardware. It is not real robot data.
      </p>
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
    </Section>
  );
}

const fmt = (x: number) => (Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(3));

function Tune({ tracks }: { tracks: Track[] }) {
  const design = useDesign();
  const rec = useRobot((s) => s.recording);
  const tune = useRobot((s) => s.tune);
  const artifact = useFirmware((s) => s.artifact);
  const fwDesign = useFirmware((s) => s.designId);
  const board = boardOf(design);
  const [trackChoice, setTrackId] = useState<string | null>(null);
  const trackId = trackChoice ?? rec?.trackId ?? "track.oval";
  const [controller, setController] = useState<"reference" | "firmware">("reference");
  const track = tracks.find((t) => t.id === trackId);
  const fwOk =
    artifact !== null &&
    fwDesign === design.id &&
    artifact.board === board?.board &&
    artifact.tier === "emulated";
  const running = tune.status === "running";
  const cal = tune.calibration;
  const at = tune.autotune;
  return (
    <Section title="Digital twin">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1">
          <span className="text-muted">Track</span>
          <select
            aria-label="Calibration track"
            value={trackId}
            onChange={(e) => {
              setTrackId(e.target.value);
            }}
            className="rounded-md border border-border bg-bg px-1 py-1"
          >
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className="text-muted">Robot ran</span>
          <select
            aria-label="Controller the robot ran"
            value={controller}
            onChange={(e) => {
              setController(e.target.value as "reference" | "firmware");
            }}
            className="rounded-md border border-border bg-bg px-1 py-1"
          >
            <option value="reference">LineLab reference PID</option>
            <option value="firmware" disabled={!fwOk}>
              The compiled sketch{fwOk ? "" : " (compile an AVR sketch first)"}
            </option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          className={primary}
          disabled={!rec || !track || running}
          onClick={() => {
            if (track)
              useRobot
                .getState()
                .calibrate(design, track, controller === "firmware" && fwOk ? artifact : undefined);
          }}
        >
          Calibrate twin
        </button>
        <button
          className={btn}
          disabled={!track || running}
          onClick={() => {
            if (track) useRobot.getState().autotune(design, track);
          }}
        >
          Auto-tune PID
        </button>
        {running && (
          <button
            className={btn}
            onClick={() => {
              useRobot.getState().cancelTune();
            }}
          >
            Cancel
          </button>
        )}
      </div>
      <p className="text-xs text-muted">
        Calibration fits friction, motor strength, driver drop and sensor gain, offset, noise and
        latency so the simulator reproduces the recording. The auto-tuner searches LineLab&apos;s
        reference PID gains on {design.calibration ? "the calibrated" : "this"} robot. Tuning your
        own sketch&apos;s gains is coming soon.
      </p>
      {running && tune.progress && (
        <p className="text-xs" aria-live="polite">
          {tune.kind === "calibrate" ? "Calibrating" : "Tuning"}: {tune.progress.done} of{" "}
          {tune.progress.total} {tune.kind === "calibrate" ? "simulations" : "candidates"}, best{" "}
          {tune.kind === "calibrate"
            ? `error ${tune.progress.best.toFixed(4)}`
            : `score ${tune.progress.best.toFixed(2)} s`}
        </p>
      )}
      {running && !tune.progress && <p className="text-xs">Starting…</p>}
      {tune.status === "error" && (
        <p className="text-xs text-red-600 dark:text-red-400">{tune.message}</p>
      )}
      {cal && (
        <div className="space-y-2 text-sm" data-testid="calibration-result">
          <p>
            Trace error {cal.before.error.toFixed(4)} → <b>{cal.after.error.toFixed(4)}</b> (
            {Math.round(cal.reduction * 100)} % lower)
            {cal.holdout && `; held-out part ${Math.round(cal.holdout.reduction * 100)} % lower`}.
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted">
                <th className="font-normal">Parameter</th>
                <th className="font-normal">Fitted</th>
              </tr>
            </thead>
            <tbody>
              {TWIN_PARAMS.map((p) =>
                cal.twin[p.key] === undefined ? null : (
                  <tr key={p.key}>
                    <td>{p.label}</td>
                    <td>
                      {fmt(cal.twin[p.key] ?? 0)} {p.unit}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
          <button
            className={primary}
            onClick={() => {
              useEditor.getState().exec({
                type: "set-calibration",
                calibration: { ...cal.twin, calibratedAt: new Date().toISOString() },
              });
            }}
          >
            Apply to design
          </button>
        </div>
      )}
      {design.calibration && (
        <p className="text-xs text-muted">
          This design is calibrated
          {design.calibration.calibratedAt
            ? ` (${new Date(design.calibration.calibratedAt).toLocaleString()})`
            : ""}
          .{" "}
          <button
            className="underline"
            onClick={() => {
              useEditor.getState().exec({ type: "set-calibration" });
            }}
          >
            Remove calibration
          </button>
        </p>
      )}
      {at && (
        <div className="space-y-2 text-sm" data-testid="autotune-result">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted">
                <th className="font-normal" />
                <th className="font-normal">Kp</th>
                <th className="font-normal">Kd</th>
                <th className="font-normal">Base</th>
                <th className="font-normal">Lap (held-out)</th>
                <th className="font-normal">Finished</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Current", at.baseline],
                  ["Tuned", at.best],
                ] as const
              ).map(([l, r]) => (
                <tr key={l}>
                  <td>{l}</td>
                  <td>{r.pid.kp}</td>
                  <td>{r.pid.kd}</td>
                  <td>{r.pid.baseDuty}</td>
                  <td>
                    {r.heldOut.meanLapTimeMs !== undefined
                      ? `${(r.heldOut.meanLapTimeMs / 1000).toFixed(2)} s`
                      : "—"}
                  </td>
                  <td>{Math.round(r.heldOut.robustness * 100)} %</td>
                </tr>
              ))}
            </tbody>
          </table>
          {at.improved ? (
            <button
              className={primary}
              onClick={() => {
                const { kp, kd, baseDuty, cornerSlowdown } = at.best.pid;
                useRun.getState().setPid({ kp, kd, baseDuty, cornerSlowdown });
                useEditor.getState().setView("run");
              }}
            >
              Use in simulator
            </button>
          ) : (
            <p className="text-xs text-muted">
              No faster gains held up on the held-out seeds; keep the current ones.
            </p>
          )}
        </div>
      )}
    </Section>
  );
}

export default function RobotView() {
  const [saved, setSaved] = useState<Track[]>([]);
  useEffect(() => {
    listTracks().then(
      (xs) => {
        setSaved(xs.map((x) => x.track));
      },
      () => undefined,
    );
  }, []);
  const tracks = useMemo(() => [...TRACKS, ...saved], [saved]);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-6xl gap-3 p-3 lg:grid-cols-2">
        <div className="space-y-3">
          <Connect />
          <Flash />
          <RecordingPanel />
        </div>
        <div className="space-y-3">
          <Live />
          <Tune tracks={tracks} />
        </div>
      </div>
    </div>
  );
}
