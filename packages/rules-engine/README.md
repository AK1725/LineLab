# @linelab/rules-engine

Pure checks over a design: `runRules(design, chassis, lookup) → Finding[]`. Each finding has a severity (error / warning / tip), a plain-language message and explanation, the affected parts, pins or nets, and sometimes a one-click `fix` made of design commands.

- **35 electrical rules** (`src/rules/electrical.ts`): shorts, supply conflicts, reverse polarity, missing common ground, unpowered parts, supply over/under-voltage, 5 V into 3.3 V pins, regulator dropout/overload/heat, motors on MCU pins, stall current vs driver, motor over-voltage, driver voltage drop, battery current, 9 V batteries, TB6612 STBY, floating driver inputs, PWM and ADC pin requirements, ESP32 ADC2 vs WiFi, input-only and strapping pins, serial pins, I2C address conflicts and pins, crossed UART, switch current, LED resistors, unread sensor channels, missing MCU/battery.
- **15 mechanical rules** (`src/rules/mechanical.ts`): collisions, missing wheels/motors, third support, centre of gravity vs support area, sensor height and ground contact (with spacer fixes), look-ahead, sensor channel count and span, caster gap (with fix), overhangs, motor strength vs weight.

Built on a circuit model (`src/circuit.ts`) that works out each net's voltage from its sources and the signal level each pin drives.

Every rule has a test that triggers it and a test that the clean reference robot does not (`src/rules.test.ts`). The Phase 3 acceptance designs live in `fixtures/` with their exact expected findings.
