# 0006. Simulation model: assumptions, contact model, controller interface

- Status: accepted
- Date: 2026-11-23

## Context

BLUEPRINT §5.6 describes the simulator: 1 kHz, motors, battery, drive, IR sensors, Monte Carlo. Implementing it needed numbers the component data doesn't have (rotor inertia, contact stiffness, IR cone angle), and a package-layout change.

## Decisions

1. **Package layout.** `sim-core` turns a `Design` into a `RobotModel` with `design-core`'s mass code. Before this change `component-db` depended on `sim-core`, only to validate track geometry, so this would have made a cycle. Track-geometry validation now runs as `sim-core`'s own `db:validate` task, and `component-db` no longer depends on `sim-core`.
2. **Motor.** Constants come from the four datasheet numbers:
   - R = V/I_stall;
   - Kt = τ_stall/(I_stall − I₀), at the output shaft, so gearbox efficiency is included;
   - Ke = (V − I₀R)/ω₀;
   - friction torque is Kt·I₀, smoothed with tanh near standstill.

   Rotor inertia is not published, so it is derived from an **assumed 15 ms mechanical time constant** (typical for N20/TT motors).

   Not modelled:
   - **winding inductance**: its time constant is < 1 ms, so it would be invisible at a 1 kHz step;
   - **PWM ripple**: duty is averaged, and 0 % duty brakes (slow decay);
   - **driver drop**: it is 60–100 % of the datasheet value depending on current.

3. **Battery.** The open-circuit voltage follows a typical curve for each chemistry between the cutoff and full voltages. Terminal voltage sags by I·R_internal, and SoC falls with the charge drawn. Brownout: the logic supply (regulator or the board's own, with dropout) falls below 85 % of nominal. The MCU then resets: zero outputs for 100 ms, and the controller state is cleared.
4. **Contact model.** Each tyre force is μN·tanh(slip / 0.05 m/s), longitudinal and lateral, limited to the friction circle. Casters are sliding (skid, μ 0.25) or rolling (ball, C_rr 0.04) friction at their position. A robot with no caster drags its chassis edge (μ 0.35), and this is stated in the run notes. Normal loads are static: they split between the axle and the casters by the CoG position, and between the wheels by the CoG's y. Fan downforce isn't modelled: no part has thrust data. The integrator is semi-implicit Euler at 1 ms, sub-stepped automatically so that h·k < 0.4 for the stiffest contact. On the reference robot that is one sub-step.
5. **IR sensors.** Each channel samples the track's analytic reflectance (ADR 0005) at 7 points of a footprint whose radius is 1.2 mm + 0.45·height. Signal strength is flat up to the sensor's optimal height, then falls with the square of the excess. Ambient light, Gaussian noise and quantisation are applied. Outputs:
   - analog: ADC counts, higher = darker, at the MCU's resolution;
   - comparator boards: 0/1, 1 = dark;
   - RC boards: decay time from 60 to 2500 µs.

   Optional latency is applied. Channel 1 is on the robot's left.

6. **Determinism.** One seeded xoshiro128** stream, no wall clock, no `Math.random`. A golden test pins the trace hash of the reference robot on the oval. V8's `Math` functions are deterministic (fdlibm), so the hash is stable across machines on the same engine. Re-pin it, with the reason, when the physics changes on purpose.
7. **Controller interface.** `tick(input) → command | undefined` runs every simulated millisecond. It returns a new command at the controller's own rate, otherwise undefined and the last command holds. The Phase 5 reference PID uses it, and so will the emulated MCU in Phase 6. The reference controller is deliberately ordinary:
   - global min/max calibration and a weighted line position;
   - PD steering with slowdown in corners;
   - a hard turn toward the last-seen side when the line is lost.
8. **Run outcome.** A run ends when one of these happens:
   - **finished**: the laps are done, or the end of an open track is reached;
   - **off_track**: both the robot centre and the sensor array are > 100 mm from any line for 500 ms;
   - **stuck**: < 30 mm of progress in 3 s;
   - **timeout**: 5 s + length at 0.2 m/s.

   Detailed failure detectors (oscillation cause, missed turn, saturation, …) are Phase 7.

## Consequences

- Numbers that are assumptions rather than data are named constants with units (`MECH_TIME_CONSTANT_S`, `SLIP_SPEED_MPS`, `SKID_MU`, …). Phase 9 calibration fits the important ones (μ, Kt scale, driver drop, sensor gain and offset, latency) to a real robot through `Design.calibration`.
- Speed on this container: 43× real time overall, 22× in the slowest run (inverted sections double the lookups). CI fails below 20×.
