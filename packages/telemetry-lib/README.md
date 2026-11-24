# @linelab/telemetry-lib

Streams what a **real** line follower sees and does to LineLab. You can then plot it live, record it, and fit the simulator's twin parameters to it.

Two halves:

- `arduino/LineLabTelemetry`: an Arduino library (C++). Install it by copying the folder into your Arduino `libraries/` directory. LineLab's compiler bundles it automatically, so `#include <LineLabTelemetry.h>` works in the in-browser editor.
- `src/`: the TypeScript codec (`FrameDecoder`, `encodeFrame`) and `RecordingBuilder`, used by the web app's Robot tab.

## Using it in a sketch

```cpp
#include <LineLabTelemetry.h>
LineLabTelemetry telemetry(Serial);          // any Print: Serial, Serial1, a BLE UART stream

void setup() {
  Serial.begin(115200);
  telemetry.begin("my_robot", 8, 10);        // name, sensor count, period (ms)
}

void loop() {
  // ... read sensors into v[8], compute left/right PWM (-255..255) ...
  if (telemetry.due()) {
    telemetry.sensors(v, 8);
    telemetry.motors(left, right);           // optional 3rd arg: max value (default 255)
    telemetry.lineLost(lost);
    telemetry.var(error);                    // up to 4 float variables
    telemetry.send();
  }
}
```

See `examples/firmware/telemetry_pid` for a complete PID sketch.

## Wire format (version 1)

All multi-byte fields are little-endian.

```
A5 5A | version (1) | type | length | payload[length] | CRC-16/CCITT-FALSE over version..payload
```

| type     | payload                                                                                                                                                                                |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 sample | `u32 micros, u8 n, u16 sensors[n], i16 pwmL×1000, i16 pwmR×1000, u16 battery mV (0 = none), u8 flags (bit0 line lost, bit1 encoders), [i32 encL, i32 encR], u8 nVars, f32 vars[nVars]` |
| 2 hello  | `u8 version, u8 sensorCount, u16 periodMs, u8 nameLen, name`                                                                                                                           |
| 3 text   | UTF-8 text (`telemetry.log("...")`)                                                                                                                                                    |

Anything between frames, for example ordinary `Serial.print` output, is skipped. Frames with a bad CRC are dropped and counted.

At 115200 baud, an 8-sensor sample with one variable takes about 40 bytes, so 10 ms (100 Hz) uses roughly a third of the link.

## Tests

- `protocol.test.ts`: codec round trips, chunking, corruption and micros() wrap.
- `emulated.test.ts`: runs the arduino-cli build of `telemetry_pid` on the emulated ATmega328P. It decodes the UART bytes and checks the reported PWM and sensors against what the simulator measured.
