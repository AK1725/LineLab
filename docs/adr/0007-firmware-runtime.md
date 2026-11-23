# 0007. Firmware runtime: two tiers, clang→wasm32 for the HAL, and the compile sandbox

- Status: accepted
- Date: 2026-11-23

## Context

BLUEPRINT §5.7 plans three tiers:

- avr8js / rp2040js emulation of the compiled binary;
- an emscripten-built HAL shim for ESP32/STM32/Teensy;
- QEMU later.

It also plans a sandboxed compiler. Phase 6 needs firmware to drive the simulated robot through the design's real wiring.

## Decisions

1. **Emulated tier = ATmega328P boards (Uno, Nano, Pro Mini) on avr8js.**
   - Each simulated millisecond:
     1. sensor readings become ADC voltages, digital inputs or RC decay times on the pins the netlist connects them to;
     2. the CPU runs `clockHz/1000` cycles;
     3. the motor-driver inputs are read back.
   - **PWM duty comes from the timer registers** (COM bits, WGM mode, OCR/TOP), not from sampling the pin. Sampling would alias against Arduino's 490/980 Hz PWM at a 1 ms tick.
   - Blink timing is exact (500 ms toggles to within 1 %).
   - Speed is about 2.8× real time, which is why the 20× benchmark is for the reference controller.
2. **RP2040, Mega 2560, 32U4 and Nano Every run on the HAL tier for now.** Emulating them needs a pin map and peripheral model for each chip. For RP2040 it also needs the arduino-pico toolchain (several hundred MB) in the compiler image. The board selector shows "Approximate (HAL)" for these boards, so nothing claims to be cycle-accurate when it isn't. rp2040js emulation is deferred.
3. **The HAL tier uses clang's wasm32 target, not emscripten.** The sketch and `packages/lfr-hal` (a small Arduino core: GPIO, ADC, PWM/LEDC, time, Serial, String, a libc subset) compile with `clang++ --target=wasm32 -nostdlib`.
   - Every hardware or time call is a WebAssembly import that the JavaScript host answers from the simulator.
   - A `--allow-undefined-file` list makes every other missing function a link error, reported as "X() isn't available in LineLab's simulated Arduino core yet".
   - Reasons: the toolchain is the distro's clang/lld (~150 MB, vs ~1 GB for emsdk); there's no JS glue; the module is a few kB; and unsupported features fail loudly instead of half-working.
   - **Time on the HAL** moves only through HAL calls, each with a fixed cost (`HAL_COST_US`: analogRead 10 µs, digitalWrite 0.3 µs, and so on). `delay()` and those costs step the simulation forward. A brownout unwinds out of WebAssembly and restarts the sketch.
   - A sketch that loops forever without any HAL call can't be pre-empted. The web worker is terminated by a 60 s watchdog with an explanation.
4. **Debug data from the compiler.** For AVR builds the compiler returns:
   - the DWARF line table (`avr-objdump --dwarf=decodedline`);
   - the symbol table (`avr-nm`), with **scalar types from DWARF** (`--dwarf=info`), so a `long` isn't shown as a float.

   The runtime uses them for:
   - a PC-sampling profiler, per source line and per file;
   - live variable watches read from SRAM.

   The **loop period** is measured as the time between successive reads of the first wired sensor (ADC conversion starts on AVR; reads on the HAL). This works whatever the code looks like, including when `loop()` is inlined into `main()`.

5. **Compile sandbox.** The compiler image bundles arduino-cli + arduino:avr and clang/lld, so it never needs the network.
   - docker-compose runs it on an `internal: true` network with 1 GB, 2 CPUs, a read-only root, no capabilities and a non-root user.
   - Each job runs in a fresh temporary directory with a clean environment, `prlimit` (1 GB address space, file size, no core dumps) and a 60 s timeout that kills the process group.
   - `apps/compiler/scripts/sandbox-check.sh` (in CI) proves from inside the container that:
     - a job can't resolve or reach any host;
     - a CPU-spinning job is killed at the time limit;
     - a job allocating > 1 GB is killed;
     - both toolchains work offline.
6. **Driver semantics live in `firmware-runtime/src/drivers.ts`** (EN/IN, IN/IN, PHASE/EN, DRV8835 mode select), with the board-level pull-ups and jumpers of each module as "floating" levels.
   - Brake (both inputs equal) and coast (disabled) both apply 0 V. The motor model has no open-circuit state yet.
   - Motor polarity convention: the driver's first output on the motor's first terminal drives the robot forward on either side. Real motors vary, so swapping wires in the design reverses that wheel in the simulation.
7. **Prebuilt example artifacts are committed** (`examples/firmware/*/*.artifact.json`, produced by `pnpm --filter @linelab/compiler examples:build` with the real toolchains). Tests and the web app can then run real compiled firmware without the compiler service. They are build outputs, regenerated whenever the examples change.

## Consequences

- Firmware runs are reproducible (same seed → same trace hash), like reference-controller runs.
- The HAL tier can't run interrupt-driven code (encoders), `pulseIn`, `tone` or hardware timers. These are compile errors with a clear message, and listed in PROGRESS.md.
