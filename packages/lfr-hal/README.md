# @linelab/lfr-hal

LineLab's simulated Arduino core: the **HAL tier** for boards that aren't emulated cycle by cycle (ESP32, STM32, RP2040, Teensy, SAMD, Mega/32U4/4809). A sketch plus `src/hal.cpp` compiles with `clang++ --target=wasm32 -nostdlib` into a small WebAssembly module. Every hardware or time call is an import (`include/hal_imports.h`, allowed list in `imports.txt`) that `@linelab/firmware-runtime`'s `HalRunner` answers from the simulator.

Supported:

- `pinMode`, `digitalRead`/`digitalWrite`
- `analogRead` (with `analogReadResolution`), `analogWrite`, ESP32 LEDC (core 3.x pin API and 2.x channel API)
- `millis`/`micros`/`delay`/`delayMicroseconds`
- `Serial.print/println/printf`, `String`
- `map`, `constrain`, `min`/`max`, `random`, and `math.h` (via the host's `Math`)
- STM32 pin names

Not supported (link error with a clear message): `attachInterrupt`, `pulseIn`, `tone`, hardware timers, and libraries beyond the core.

**Timing is approximate.** Time only moves when the sketch calls the core, at fixed costs per call (`HAL_COST_US` in firmware-runtime). The UI labels these runs "Approximate (HAL)".
