# 0010. Real-world loop: own telemetry protocol, STK500 in the browser, CMA-ES and BO in workers

- Status: accepted
- Date: 2026-11-24

## Context

BLUEPRINT §2.2 A, B and F and §5.9.1 call for four things:

- live telemetry from a real robot over Web Serial or Web Bluetooth;
- browser flashing (the build plan names avrgirl, esptool-js and UF2);
- per-robot digital-twin calibration ("CMA-ES or Bayesian optimisation in a worker");
- a PID auto-tuner.

The acceptance criteria are:

- calibration from a recorded real-robot fixture cuts sim-vs-real trace error by at least 40 %;
- the auto-tuner improves lap time on a fixture design without lowering robustness.

## Decisions

1. **A small binary protocol, not CSV over Serial.print.** Every frame is `A5 5A | version | type | len | payload | CRC-16/CCITT-FALSE`, with little-endian fields.
   - Frame types: samples, hello and text.
   - A 100 Hz, 8-sensor stream fits in a third of 115200 baud.
   - Plain `Serial.print` debug text in between is skipped, and corrupt frames are dropped and counted.
   - The library (`LineLabTelemetry`) writes to any `Print`, so the same code works on Serial, Serial1 or a BLE UART.
   - LineLab's compiler bundles it, so `#include <LineLabTelemetry.h>` works in the editor. The same source compiles for the Nano (arduino-cli `--library`) and on the HAL tier.
2. **Our own STK500v1 flasher (~150 lines) instead of avrgirl-arduino.** avrgirl targets Node serialport, and its browser build pulls in polyfills for Node streams and Buffer. Optiboot and ATmegaBOOT only use eight STK500 commands. Owning them also gives:
   - verify-by-readback;
   - signature checking;
   - a bootloader-overlap guard;
   - honest error hints (wrong baud, no DTR).

   The flasher is tested against a software Optiboot: unit tests run against the bootloader in the same process, and the e2e test runs against a fake `navigator.serial`.

   **ESP32 (esptool-js), RP2040 (UF2) and STM32 flashing are not built yet.** They need either another dependency (esptool-js is about 400 kB with its stub flasher images, and is Apache-2.0) or board-specific USB flows we can't test without hardware. The UI says "coming soon" for those boards.

3. **Web Bluetooth: Nordic UART and HM-10 only.** These two GATT layouts cover the common modules (ESP32 BLE sketches, nRF, HM-10/CC2541 clones). Classic Bluetooth modules (HC-05/06) show up as serial ports, so they use Web Serial.
4. **Calibration is a closed-loop replay.** The simulator runs the same controller the robot ran, from the same start, for each candidate twin. That controller is the compiled firmware on the emulated MCU, or the reference PID. The objective compares the simulated run with the recording:
   - low-passed (±40 ms) sensor and PWM traces, RMS;
   - a high-pass noise-level term;
   - the best clock offset within one telemetry period, after locating motion start in both traces.

   Open-loop PWM replay was rejected: the simulated pose drifts away from the real one within a second, so sensors stop being comparable. Pointwise comparison of raw PWM was rejected because it is dominated by noise the controller amplifies, which no twin can reproduce sample by sample.

5. **CMA-ES for calibration, GP-EI Bayesian optimisation for tuning, both hand-written and deterministic for a seed** (`packages/calibrate`, no dependencies).
   - Calibration has 8 parameters, cheap evaluations (about 0.1 s), and a noisy, non-smooth objective, which suits CMA-ES.
   - Tuning has 4 parameters and expensive evaluations (Monte Carlo over seeds), which suits BO.
   - Both run in a Web Worker in the app. The same code can run in a BullMQ worker later.
6. **The auto-tuner penalises robustness loss and re-checks on held-out seeds.** `improved` is true only if the winner is faster on seeds it never saw, and no less robust on either set. Otherwise the UI says to keep the current gains. It tunes LineLab's reference PID. Tuning the gains inside the user's own sketch (by writing its globals in the emulator, then patching the constants) is listed as coming soon.
7. **The twin's sensor parameters live on the robot model.** `RobotModel.sensorTwin` holds gain, offset, noise and extra latency, set from `Design.calibration`. A design with no calibration simulates exactly as before (the golden hash is unchanged). A new `set-calibration` design command makes applying a calibration undoable.

## Consequences

- **No real-robot recording exists yet.** The calibration acceptance test uses a **synthetic** fixture: the simulator running a robot with hidden parameters and its own noise seed. It is labelled `source: "synthetic"` in the file, in its notes, and in the UI. It demonstrates that the optimiser and objective work. It does not show how far the twin model is from real hardware. A real recording is the first thing to add (PROGRESS.md).
- Motor strength and driver drop are only weakly identifiable from sensors and PWM: both change speed. Encoders are in the protocol but not yet in the objective.
- Calibrating against emulated firmware is about 5–10× slower than against the reference PID, so the app uses a smaller evaluation budget for firmware.
