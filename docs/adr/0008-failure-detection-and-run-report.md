# 0008. Failure detection, static analysis and the run report

- Status: accepted
- Date: 2026-11-24

## Context

BUILD_PLAN Phase 7 asks for:

- the BLUEPRINT §5.6 detectors, with each event linked to a source line;
- clang-tidy/cppcheck plus custom line-follower rules;
- 12 buggy sketches that must each be caught at the right line.

The open questions were where each piece lives, how to tie a runtime event to a source line, and how to keep detectors honest.

## Decisions

1. **Detectors are pure functions over the trace** (`sim-core/src/detect`), each with a triggering and a non-triggering test on synthetic traces.
   - The trace gained two ground-truth channels, `lineSeen` (sensors over the line) and `distanceMm`. The golden hash was re-pinned; the physics is unchanged.
   - Thresholds are named constants (`LIMITS`), and every event carries a plain-language `message` with what to try.
   - Detectors:
     - line lost/reacquired;
     - oscillation, with the dominant frequency from a DFT; ≥ 4 Hz → "P too high", below → "D too low";
     - PWM saturation;
     - missed turn (heading change around the failure point);
     - blocking delay;
     - loop jitter;
     - infinite loop (stall);
     - integrator windup (watched variables);
     - wrong motor direction;
     - inverted steering;
     - pass-through of brownout, off-track and stuck.
2. **Source lines, exact where measured, otherwise "likely".**
   - The emulator marks which flash words belong to the sketch, using the DWARF line table. When execution leaves the sketch for the Arduino core and stays there ≥ 5 ms, it records the call site from the program counter (`blocking_delay`). A stretch with no sensor reads while executing the sketch records where it is (`infinite_loop`).
   - With link-time optimisation, `delay()` can be inlined and the last sketch instruction may belong to the statement before it. The report then picks the next blocking call in the source and marks it "likely".
   - Other events (oscillation → Kp/Kd, steering → the weighting line, wrong direction → the call that drives that motor's direction pins, and so on) get a line by pattern from `run-report`'s `locate()`. These are always marked "likely". When nothing fits, there is no line rather than a wrong one.
3. **Wrong direction is judged at the start of the run.** With the robot straight on the line, any sane controller's first commands drive both wheels forwards. A wheel commanded backwards in the first three active samples means its "forward" is reversed. (A minute-long spin test missed it: the PID reacts within 40 ms and both wheels end up backwards.) Inverted steering takes precedence over a later spin, which is its consequence.
4. **`packages/firmware-lint`** holds the line-follower rules:
   - delay in loop;
   - integer PID maths;
   - unclamped integral;
   - millis() overflow;
   - analogWrite range;
   - PID state in locals;
   - float ==;
   - P-only control;
   - hard-coded thresholds;
   - unguarded weighted average;
   - **pins that don't match the netlist**, followed through helper-function parameters.

   It is pure TypeScript over a comment- and string-stripped view of the sketch, not a C++ parser. It runs in the browser as you type and needs no compiler.

5. **cppcheck and clang-tidy run in the compiler sandbox** (`POST /analyze`). They parse against LineLab's own Arduino headers (`lfr-hal`), which give one Arduino API for every board, so clang-tidy needs no avr-gcc. clang-tidy ignores `#line`, so its line numbers are shifted back to the sketch. The check set is bugprone-*, a subset of clang-analyzer, cert-flp30-c and misleading indentation, with noisy style checks off.
6. **`packages/run-report`** combines the detectors, attribution, lint and metrics into one `RunReport` for the worker, the agent (Phase 8) and the fixture harness. `examples/firmware/buggy/expected.json` lists, for each of the 12 fixtures, the track, the expected event or rule, the line, and a text fragment of that line. A stale line number fails the test.

## Consequences

- A firmware run's report shows each problem once, with a time and a line where one can be found. The UI marks pattern-based lines "(likely)".
- The detectors also work for reference-controller runs; those have no source lines.
- Not done: `wdt_reset` (no watchdog model); infinite-loop detection on the HAL tier (it can't be pre-empted; the worker watchdog covers it); smoothness scoring.
