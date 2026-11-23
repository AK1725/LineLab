# Component data review — 2026-11-23

Top line-follower parts checked against manufacturer pages and datasheets fetched on 2026-11-23 (pololu.com, vishay.com, ti.com). **24 entries are now `specStatus: "reviewed"`**: their dimensions, mass, pin names and electrical specs were all checked. Values that could not be sourced were **removed** rather than kept unverified (wheel friction, regulator efficiency, some PWM limits).

## Corrections (old → verified)

| Part                      | Field                          | Was                                | Now                                                                                             | Source                            |
| ------------------------- | ------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------- |
| TB6612FNG carrier         | continuous / peak per channel  | 1.2 / 3.2 A                        | **1 / 3 A**                                                                                     | Pololu #713                       |
|                           | mass                           | 1.6 g                              | **1.5 g**                                                                                       |                                   |
|                           | motor supply pin               | VM                                 | **VMOT**                                                                                        |                                   |
| DRV8833 carrier           | max PWM                        | 50 kHz                             | _removed_ (50 kHz is the internal chopping frequency)                                           | TI datasheet                      |
|                           | pins                           | —                                  | **+ VMM** (protected supply out)                                                                | Pololu #2130                      |
| DRV8835 carrier           | size                           | 10.2 × 15.2 mm                     | **10.2 × 17.8 mm**                                                                              | Pololu #2135                      |
|                           | mass                           | 0.7 g                              | **0.5 g**                                                                                       |                                   |
|                           | pins                           | VM                                 | **VIN + VMM**                                                                                   |                                   |
| MAX14870 carrier          | mass                           | 0.6 g                              | **0.5 g**                                                                                       | Pololu #2961                      |
|                           | pins                           | VM (input)                         | **VIN** input, **VM** protected output                                                          |                                   |
| QTR-8RC, QTR-1RC          | max sensing distance           | 6 mm                               | **9.5 mm**                                                                                      | Pololu #961, #959                 |
| QTR-1A / 1RC              | mass, height                   | 0.3 g, 3 mm                        | **0.2 g, 2.5 mm**; marked **discontinued**                                                      | Pololu #958, #959                 |
| QTR-MD-08A / 08RC         | size                           | 10 × 66 × 3                        | **20 × 61 × 2.5 mm**                                                                            | Pololu #4248, #4148               |
|                           | current, sensing range         | 90 mA, 1–5 mm                      | **125 mA, 5–40 mm**                                                                             |                                   |
|                           | control pin                    | CTRL                               | **CTRL ODD + CTRL EVEN**                                                                        |                                   |
| QTR-HD-15A                | size, mass, current, range     | 10 × 64 × 3, 2.5 g, 150 mA, 1–5 mm | **20 × 61 × 2.5 mm, 3.5 g, 250 mA, 5–50 mm**                                                    | Pololu #4215                      |
| Micro metal HP 6V         | 10:1 speed / torque            | 3000 rpm / 0.3 kg·cm               | **3100 / 0.22**                                                                                 | Pololu category 173               |
|                           | 50:1                           | 625 / 1.0                          | **590 / 0.86**                                                                                  |                                   |
|                           | 100:1                          | 320 / 2.0                          | **310 / 1.7**                                                                                   |                                   |
|                           | 30:1 torque, 1000:1 speed      | 0.6, 32                            | **0.57, 31**                                                                                    |                                   |
|                           | 1000:1 length, mass            | 34 mm, 9.5 g                       | **37.5 mm, 10.5 g**                                                                             | Pololu #2373                      |
|                           | gear ratios                    | nominal                            | **exact** (9.96, 29.86, 51.45, 100.37, 986.41)                                                  |                                   |
| Micro metal HPCB 12V      | 10:1 torque                    | 0.2                                | **0.17 kg·cm**                                                                                  | Pololu category 200               |
|                           | 30:1 torque                    | 0.6                                | **0.39 kg·cm**                                                                                  |                                   |
|                           | free current                   | 0.06 A                             | **0.08 A**                                                                                      |                                   |
| Pololu wheels (per wheel) | 32×7 / 40×7 / 60×8 / 70×8 mass | 1.6 / 2.5 / 5 / 7 g                | **3.1 / 4.3 / 11.3 / 14.2 g**                                                                   | Pololu #1087, #1453, #1420, #1425 |
| Ball casters              | 3/8″ metal, 3/4″ metal mass    | 2 g, 25 g                          | **4 g, 30 g** (housing size still unchecked)                                                    | Pololu #951, #955                 |
| S7V8F5                    | size, mass                     | 12.7 × 17.8 × 4, 1.5 g             | **11.4 × 16.5 × 2.5 mm, 0.6 g**; source was the wrong product (#2119 is the S7V7F5) → **#2123** | Pololu #2123                      |
| D24V10F5                  | input min, size, mass          | 6 V, 12.7 × 15.2 × 4, 1.5 g        | **5.1 V, 12.7 × 17.8 × 3.6 mm, 1.0 g**                                                          | Pololu #2831                      |
|                           | pins                           | EN                                 | **SHDN + PG**                                                                                   |                                   |
| L293D                     | width; max PWM                 | 6.4 mm; 5 kHz                      | **6.35 mm; removed** (not specified)                                                            | TI datasheet                      |
| LM2596 module             | output min                     | 1.25 V                             | **1.2 V**                                                                                       | TI datasheet                      |
| TCRT5000 modules          | sensing range                  | 1–8 mm                             | **0.2–15 mm** (peak 2.5 mm)                                                                     | Vishay datasheet                  |
| CNY70 module              | sensing range                  | 0.3–3 mm                           | **0–5 mm** (peak < 0.5 mm)                                                                      | Vishay datasheet                  |

## Confirmed unchanged

TB6612 voltages and 100 kHz PWM, all DRV8833 carrier values, DRV8835 voltages, currents and 250 kHz PWM, QTR-8A/8RC size, mass, current and pitch, motor stall/free currents, wheel sizes, L293D/DRV8835/DRV8871 electrical values, LM2596 input range.

## Not checked

- **st.com (L298, L7805, STM32 Blue/Black Pill, VL53L0X/L1X):** ST's server refuses automated downloads (empty replies), and the web-fetch tool cannot resolve the host. These entries stay `needs-review`.
- Boards from other makers (Arduino, Espressif, Raspberry Pi, Adafruit, generic modules) were outside this pass.
