// Functions the JavaScript host provides (see packages/firmware-runtime/src/hal.ts).
// Every call that touches hardware or time goes through here, so the simulator stays in control.
#pragma once
#include <stdint.h>

#define LL_IMPORT(name) __attribute__((import_module("env"), import_name(#name)))

#ifdef __cplusplus
extern "C" {
#endif
LL_IMPORT(hal_pin_mode) void hal_pin_mode(int pin, int mode);
LL_IMPORT(hal_digital_write) void hal_digital_write(int pin, int value);
LL_IMPORT(hal_digital_read) int hal_digital_read(int pin);
/** Reading as a fraction of full scale (0..1). */
LL_IMPORT(hal_analog_read) double hal_analog_read(int pin);
/** PWM duty as a fraction (0..1). */
LL_IMPORT(hal_analog_write) void hal_analog_write(int pin, double duty);
LL_IMPORT(hal_millis) double hal_millis(void);
LL_IMPORT(hal_micros) double hal_micros(void);
LL_IMPORT(hal_delay) void hal_delay(double ms);
LL_IMPORT(hal_delay_us) void hal_delay_us(double us);
LL_IMPORT(hal_serial_write) void hal_serial_write(const char* data, int len);
LL_IMPORT(hal_random) uint32_t hal_random(void);
#ifdef __cplusplus
}
#endif
