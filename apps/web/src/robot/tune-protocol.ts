import type { AutotuneResult, CalibrationResult } from "@linelab/calibrate";
import type { Design, FirmwareArtifact, TelemetryRecording, Track } from "@linelab/schema";

export type TuneRequest =
  | {
      id: number;
      kind: "calibrate";
      design: Design;
      track: Track;
      recording: TelemetryRecording;
      /** The firmware the robot ran (emulated tier), or undefined for the reference PID. */
      firmware?: FirmwareArtifact;
      maxEvals: number;
    }
  | { id: number; kind: "autotune"; design: Design; track: Track; iterations: number };

export type TuneResponse =
  | { id: number; kind: "progress"; done: number; total: number; best: number }
  | { id: number; kind: "calibrated"; result: CalibrationResult }
  | { id: number; kind: "tuned"; result: AutotuneResult }
  | { id: number; kind: "error"; message: string };
