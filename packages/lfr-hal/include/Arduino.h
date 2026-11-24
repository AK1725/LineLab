// LineLab's simulated Arduino core (the "HAL" tier). Sketches for ESP32, STM32, RP2040, Teensy,
// SAMD and non-328P AVR boards compile against this header to WebAssembly and run inside the
// simulator. Timing is approximate: each call costs a fixed time (see firmware-runtime/src/hal.ts)
// and there are no timers or interrupts. Unsupported functions fail to link with a clear message.
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <avr/pgmspace.h>
#include "hal_imports.h"

typedef uint8_t byte;
typedef bool boolean;
typedef unsigned int word;

#define HIGH 0x1
#define LOW 0x0
#define INPUT 0x0
#define OUTPUT 0x1
#define INPUT_PULLUP 0x2
#define INPUT_PULLDOWN 0x3

#define PI 3.1415926535897932384626433832795
#define HALF_PI 1.5707963267948966192313216916398
#define TWO_PI 6.283185307179586476925286766559
#define DEG_TO_RAD 0.017453292519943295769236907684886
#define RAD_TO_DEG 57.295779513082320876798154814105

#if defined(LINELAB_BOARD_ESP32)
#define LED_BUILTIN 2
#define LINELAB_ADC_BITS 12
#elif defined(LINELAB_BOARD_RP2040)
#define LED_BUILTIN 25
#define LINELAB_ADC_BITS 10
#elif defined(LINELAB_BOARD_STM32)
#define LED_BUILTIN 45 /* PC13 */
#define LINELAB_ADC_BITS 10
#else
#define LED_BUILTIN 13
#define LINELAB_ADC_BITS 10
#endif

// Analog pin names.
#if defined(LINELAB_BOARD_ESP32)
#define A0 36
#define A3 39
#define A4 32
#define A5 33
#define A6 34
#define A7 35
#elif !defined(LINELAB_BOARD_STM32)
#define A0 14
#define A1 15
#define A2 16
#define A3 17
#define A4 18
#define A5 19
#define A6 20
#define A7 21
#endif

#if defined(LINELAB_BOARD_STM32)
// STM32 pin names: port × 16 + pin (PA0 = 0, PB0 = 16, PC13 = 45, ...).
#define PA0 0
#define PA1 1
#define PA2 2
#define PA3 3
#define PA4 4
#define PA5 5
#define PA6 6
#define PA7 7
#define PA8 8
#define PA9 9
#define PA10 10
#define PA11 11
#define PA12 12
#define PA15 15
#define PB0 16
#define PB1 17
#define PB3 19
#define PB4 20
#define PB5 21
#define PB6 22
#define PB7 23
#define PB8 24
#define PB9 25
#define PB10 26
#define PB12 28
#define PB13 29
#define PB14 30
#define PB15 31
#define PC13 45
#define PC14 46
#define PC15 47
#endif

#define F(s) (s)
typedef char __FlashStringHelper;

#define lowByte(w) ((uint8_t)((w) & 0xff))
#define highByte(w) ((uint8_t)((w) >> 8))
#define bitRead(value, bit) (((value) >> (bit)) & 0x01)
#define bitSet(value, bit) ((value) |= (1UL << (bit)))
#define bitClear(value, bit) ((value) &= ~(1UL << (bit)))
#define bit(b) (1UL << (b))
#define sq(x) ((x) * (x))
#define radians(deg) ((deg) * DEG_TO_RAD)
#define degrees(rad) ((rad) * RAD_TO_DEG)

#ifdef __cplusplus
template <class T, class U> static inline decltype(true ? T() : U()) min(T a, U b) { return a < b ? a : b; }
template <class T, class U> static inline decltype(true ? T() : U()) max(T a, U b) { return a > b ? a : b; }
template <class T, class L, class H> static inline T constrain(T x, L lo, H hi) { return x < lo ? (T)lo : x > hi ? (T)hi : x; }
static inline long abs(long x) { return x < 0 ? -x : x; }
static inline float abs(float x) { return x < 0 ? -x : x; }
static inline double abs(double x) { return x < 0 ? -x : x; }
static inline long round(double x) { return (long)(x < 0 ? x - 0.5 : x + 0.5); }
#endif

void pinMode(uint8_t pin, uint8_t mode);
void digitalWrite(uint8_t pin, uint8_t value);
int digitalRead(uint8_t pin);
int analogRead(uint8_t pin);
void analogReadResolution(int bits);
void analogWrite(uint8_t pin, int value);
void analogWriteResolution(int bits);
unsigned long millis(void);
unsigned long micros(void);
void delay(unsigned long ms);
void delayMicroseconds(unsigned int us);
void yield(void);
static inline void noInterrupts(void) {}
static inline void interrupts(void) {}
long map(long x, long inMin, long inMax, long outMin, long outMax);
long random(long max);
long random(long min, long max);
void randomSeed(unsigned long seed);

// ESP32 LEDC PWM: core 3.x (pin-based) and 2.x (channel-based) APIs.
bool ledcAttach(uint8_t pin, uint32_t freq, uint8_t resolution);
uint32_t ledcSetup(uint8_t channel, uint32_t freq, uint8_t resolution);
void ledcAttachPin(uint8_t pin, uint8_t channel);
bool ledcWrite(uint8_t pinOrChannel, uint32_t duty);

// Not simulated: interrupts, pulse timing, tone. Declared so the error says so at link time.
void attachInterrupt(uint8_t interrupt, void (*isr)(void), int mode);
unsigned long pulseIn(uint8_t pin, uint8_t state, unsigned long timeout = 1000000UL);
void tone(uint8_t pin, unsigned int frequency, unsigned long duration = 0);
#define digitalPinToInterrupt(p) (p)
#define CHANGE 1
#define FALLING 2
#define RISING 3

#include "WString.h"
#include "HardwareSerial.h"

// C linkage so the host can call them by name (a later `void setup() {...}` inherits it).
#ifdef __cplusplus
extern "C" {
#endif
void setup(void);
void loop(void);
#ifdef __cplusplus
}
#endif
