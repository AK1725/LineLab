# @linelab/firmware-runtime

Runs the user's firmware as the robot's controller in `@linelab/sim-core`.

- `resolveWiring(design, lookup, robot)`: follows the netlist from each sensor channel to an MCU pin, and from MCU pins through the motor driver's logic (`drivers.ts`) to each wheel's motor, polarity included. Lists wiring that will stop the robot.
- **Emulated tier** (`AvrMcu`, `AvrController`): ATmega328P on avr8js, with:
  - ADC, GPIO, timers 0–2 (PWM duty from the registers), USART and RC-sensor decay;
  - a PC-sampling profiler mapped to source lines;
  - typed SRAM variable watches;
  - loop-period measurement.
- **HAL tier** (`HalRunner`): WebAssembly sketches built against `@linelab/lfr-hal`; approximate timing.
- `runFirmware({...})` runs either tier and returns the sim result, serial output, loop stats, profile and watches.

See [ADR 0007](../../docs/adr/0007-firmware-runtime.md). Tests run the real compiled examples in `examples/firmware`.
