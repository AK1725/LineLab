#include "LineLabTelemetry.h"
#include <string.h>

static uint16_t crc16(const uint8_t* d, uint8_t n, uint16_t crc) {
  for (uint8_t i = 0; i < n; i++) {
    crc ^= (uint16_t)d[i] << 8;
    for (uint8_t b = 0; b < 8; b++) crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021) : (uint16_t)(crc << 1);
  }
  return crc;
}

static uint8_t* put16(uint8_t* p, uint16_t v) {
  p[0] = v & 0xff;
  p[1] = v >> 8;
  return p + 2;
}
static uint8_t* put32(uint8_t* p, uint32_t v) {
  for (uint8_t i = 0; i < 4; i++) p[i] = (v >> (8 * i)) & 0xff;
  return p + 4;
}

void LineLabTelemetry::frame(uint8_t type, const uint8_t* payload, uint8_t len) {
  uint8_t head[5] = {0xA5, 0x5A, VERSION, type, len};
  uint16_t crc = crc16(head + 2, 3, 0xFFFF);
  crc = crc16(payload, len, crc);
  uint8_t tail[2] = {(uint8_t)(crc & 0xff), (uint8_t)(crc >> 8)};
  out_.write(head, 5);
  out_.write(payload, len);
  out_.write(tail, 2);
}

void LineLabTelemetry::begin(const char* name, uint8_t sensorCount, uint16_t periodMs) {
  periodMs_ = periodMs ? periodMs : 10;
  nSensors_ = sensorCount > MAX_SENSORS ? MAX_SENSORS : sensorCount;
  uint8_t p[40];
  uint8_t n = (uint8_t)strlen(name);
  if (n > 32) n = 32;
  p[0] = VERSION;
  p[1] = nSensors_;
  put16(p + 2, periodMs_);
  p[4] = n;
  memcpy(p + 5, name, n);
  frame(2, p, (uint8_t)(5 + n));
  last_ = millis();
}

bool LineLabTelemetry::due() {
  unsigned long now = millis();
  if (now - last_ < periodMs_) return false;  // unsigned subtraction: safe across overflow
  last_ = now;
  return true;
}

void LineLabTelemetry::sensors(const int* values, uint8_t n) {
  if (n > MAX_SENSORS) n = MAX_SENSORS;
  nSensors_ = n;
  for (uint8_t i = 0; i < n; i++) sensors_[i] = values[i] < 0 ? 0 : (uint16_t)values[i];
}

void LineLabTelemetry::motors(int left, int right, int maxValue) {
  if (maxValue <= 0) maxValue = 255;
  long l = (long)left * 1000 / maxValue, r = (long)right * 1000 / maxValue;
  pwmL_ = (int16_t)constrain(l, -1000L, 1000L);
  pwmR_ = (int16_t)constrain(r, -1000L, 1000L);
}

void LineLabTelemetry::send() {
  uint8_t p[4 + 1 + 2 * MAX_SENSORS + 2 + 2 + 2 + 1 + 8 + 1 + 4 * MAX_VARS];
  uint8_t* q = put32(p, micros());
  *q++ = nSensors_;
  for (uint8_t i = 0; i < nSensors_; i++) q = put16(q, sensors_[i]);
  q = put16(q, (uint16_t)pwmL_);
  q = put16(q, (uint16_t)pwmR_);
  q = put16(q, batteryMv_);
  *q++ = (uint8_t)((lineLost_ ? 1 : 0) | (hasEncoders_ ? 2 : 0));
  if (hasEncoders_) {
    q = put32(q, (uint32_t)encL_);
    q = put32(q, (uint32_t)encR_);
  }
  *q++ = nVars_;
  for (uint8_t i = 0; i < nVars_; i++) {
    uint32_t bits;
    memcpy(&bits, &vars_[i], 4);
    q = put32(q, bits);
  }
  frame(1, p, (uint8_t)(q - p));
  nVars_ = 0;
}

void LineLabTelemetry::log(const char* text) {
  uint8_t n = (uint8_t)strlen(text);
  if (n > 200) n = 200;
  frame(3, (const uint8_t*)text, n);
}
