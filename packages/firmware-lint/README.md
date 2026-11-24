# @linelab/firmware-lint

Line-follower static analysis for Arduino sketches, in pure TypeScript. It runs in the browser as you type. Each rule names a line and explains the bug in plain language; each has a triggering and a non-triggering test.

| Rule                      | Catches                                                                         |
| ------------------------- | ------------------------------------------------------------------------------- |
| `lfr.delay-in-loop`       | `delay(≥5)` outside `setup()`                                                   |
| `lfr.integer-pid-math`    | integer gains; integer division in lines that use the gains                     |
| `lfr.integral-no-clamp`   | an integral that accumulates without `constrain`/`min`/`max`                    |
| `lfr.millis-overflow`     | `millis() > last + interval`; millis()/micros() stored in short or signed types |
| `lfr.analogwrite-range`   | values outside 0–255, or values that are never limited                          |
| `lfr.pid-state-local`     | `lastError`/`integral` declared inside `loop()`                                 |
| `lfr.float-equality`      | `==` / `!=` on floats                                                           |
| `lfr.no-derivative`       | Kp without a working D term                                                     |
| `lfr.hardcoded-threshold` | analogRead results compared with fixed numbers                                  |
| `lfr.unguarded-average`   | `/ sum` with no check for "no sensor sees the line"                             |
| `lfr.pin-mismatch`        | pins in code that don't match the design's netlist (needs `PinContext`)         |

It works on a comment- and string-stripped view of the sketch (functions, declarations, constants, call arguments, helper parameters one level deep). It is not a C++ parser, so it can miss unusual code; cppcheck and clang-tidy in the compiler service complement it.
