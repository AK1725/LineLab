# @linelab/run-report

One report per simulated run: `buildRunReport({ result, field, recordEveryMs, firmware? })` returns the outcome, metrics, detector events and LineLab lint findings.

Each event carries a message and, where possible, a source line:

- **exact** (measured from the program counter) for blocking calls and stalls;
- **likely** (found by pattern, `locate()`) for oscillation, wrong direction, inverted steering, a lost line with no recovery, and so on.

`pinContextFor(wiring)` gives the lint rules the design's pins.

`src/fixtures.test.ts` is the Phase 7 acceptance test. Every sketch in `examples/firmware/buggy` must trigger the event or rule listed in `expected.json` at the listed line, and `good_pid.ino` must produce no errors on three tracks.
