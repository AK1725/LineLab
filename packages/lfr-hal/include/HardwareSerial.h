#pragma once
#include <stddef.h>
#include <stdint.h>
#include "WString.h"

#define DEC 10
#define HEX 16
#define OCT 8
#define BIN 2

/** Byte sink, as in the Arduino core (libraries such as LineLabTelemetry write to a Print&). */
class Print {
 public:
  virtual ~Print() {}
  virtual size_t write(uint8_t c) = 0;
  virtual size_t write(const uint8_t* buf, size_t n) {
    size_t k = 0;
    while (n--) k += write(*buf++);
    return k;
  }
};

class HardwareSerial : public Print {
 public:
  void begin(unsigned long baud) { (void)baud; }
  void begin(unsigned long baud, uint32_t config) { (void)baud; (void)config; }
  void end() {}
  int available() { return 0; }
  int read() { return -1; }
  int peek() { return -1; }
  void flush() {}
  size_t write(uint8_t c) override;
  size_t write(const char* s);
  size_t write(const uint8_t* buf, size_t n) override;
  size_t print(const char* s);
  size_t print(const String& s);
  size_t print(char c);
  size_t print(int v, int base = DEC);
  size_t print(unsigned int v, int base = DEC);
  size_t print(long v, int base = DEC);
  size_t print(unsigned long v, int base = DEC);
  size_t print(double v, int digits = 2);
  size_t println();
  template <class T> size_t println(T v) { size_t n = print(v); return n + println(); }
  template <class T> size_t println(T v, int f) { size_t n = print(v, f); return n + println(); }
  size_t printf(const char* fmt, ...);
  operator bool() { return true; }
};

extern HardwareSerial Serial;
extern HardwareSerial Serial1;
extern HardwareSerial Serial2;
