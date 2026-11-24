# @linelab/calibrate

The digital-twin calibrator and the PID auto-tuner (BLUEPRINT §2.2 B/F, §5.9.1). Pure TypeScript and deterministic for a seed, so they run in a Web Worker, in a BullMQ worker, or in tests.

## Twin calibration (`calibrateTwin`)

The input is a telemetry recording (`TelemetryRecording`, produced by LineLabTelemetry and the Robot tab), the design, the track, and the controller the robot ran. That controller is either its compiled firmware on the emulated MCU or the reference PID.

CMA-ES (`cmaes.ts`, Hansen's tutorial algorithm, with rank-one and rank-μ updates and CSA) searches over the parameters in `TWIN_PARAMS`:

- tyre μ;
- per-side motor strength;
- driver voltage drop;
- sensor gain, offset and noise;
- sensor latency.

For each candidate it simulates the same controller from the same start and compares that run with the recording (`replay.ts`):

- **Sensors and PWM**, low-passed (±40 ms), RMS. Controllers turn sensor noise into PWM jitter that no twin can reproduce sample by sample, which is why the signals are low-passed before comparison.
- **Noise level**: high-pass RMS of the sensors, sim versus real.
- **Clock alignment**: the motion start is located in both traces, and the best offset within ±1 telemetry period is used.

The result reports the error before and after on the fit window and on a held-out window.

Not every parameter is identifiable from sensors and PWM alone. Motor strength and driver drop both change speed, so they trade off against each other. Encoder telemetry is carried by the protocol but not used by the objective yet.

## PID auto-tuner (`autotunePid`)

Bayesian optimisation (`bayesopt.ts`) searches over the reference controller's `kp`, `kd`, base duty and corner slowdown:

- a Gaussian process with a squared-exponential kernel, length scale chosen by marginal likelihood;
- expected improvement as the acquisition function;
- a Latin-hypercube start that includes the current gains.

The objective is mean lap time over Monte Carlo seeds, plus a steep penalty for any robustness below that of the starting gains. The winner is re-run on held-out seeds, and `improved` is true only if it is faster there and no less robust on either seed set.

## Fixtures

`fixtures/hidden-twin.recording.json` is **synthetic**: the simulator running the reference robot with the hidden parameters in `hidden-twin.truth.json`, with its own noise seed, sampled at 10 ms like LineLabTelemetry. It stands in for a real-robot recording, which is still wanted (see docs/PROGRESS.md). Regenerate it with `pnpm --filter @linelab/calibrate fixture:generate`.
