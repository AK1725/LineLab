// LineLabTelemetry: stream line-follower telemetry to LineLab (https://github.com/AK1725/linelab).
//
// Frame (little-endian): A5 5A | version | type | length | payload[length] | CRC-16/CCITT-FALSE
// over version..payload. Types: 1 = sample, 2 = hello, 3 = text. See README for the payloads.
//
//   LineLabTelemetry telemetry(Serial);
//   void setup() { Serial.begin(115200); telemetry.begin("my_robot", 8); }
//   void loop() {
//     ...read sensors, compute PID, drive motors...
//     if (telemetry.due()) {
//       telemetry.sensors(values, 8);
//       telemetry.motors(leftPwm, rightPwm);   // signed, -255..255
//       telemetry.var(error);                  // up to 4 values you want to plot
//       telemetry.send();
//     }
//   }
#pragma once
#include <Arduino.h>

class LineLabTelemetry {
 public:
  static const uint8_t VERSION = 1;
  static const uint8_t MAX_SENSORS = 16;
  static const uint8_t MAX_VARS = 4;

  explicit LineLabTelemetry(Print& out) : out_(out) {}

  /** Announce the robot (name, sensor count) and set the sample period in ms. */
  void begin(const char* name, uint8_t sensorCount, uint16_t periodMs = 10);
  /** True once per sample period (non-blocking; uses millis()). */
  bool due();
  void sensors(const int* values, uint8_t n);
  /** Signed motor commands, scaled by maxValue (255 for analogWrite). */
  void motors(int left, int right, int maxValue = 255);
  void battery(uint16_t millivolts) { batteryMv_ = millivolts; }
  void encoders(long left, long right) {
    encL_ = left;
    encR_ = right;
    hasEncoders_ = true;
  }
  void var(float v) {
    if (nVars_ < MAX_VARS) vars_[nVars_++] = v;
  }
  void lineLost(bool lost) { lineLost_ = lost; }
  /** Write one sample frame and clear the per-sample variables. */
  void send();
  /** A short text message (shown in LineLab's log). */
  void log(const char* text);

 private:
  void frame(uint8_t type, const uint8_t* payload, uint8_t len);
  Print& out_;
  uint16_t periodMs_ = 10;
  unsigned long last_ = 0;
  uint8_t nSensors_ = 0;
  uint16_t sensors_[MAX_SENSORS];
  int16_t pwmL_ = 0, pwmR_ = 0;
  uint16_t batteryMv_ = 0;
  long encL_ = 0, encR_ = 0;
  bool hasEncoders_ = false, lineLost_ = false;
  uint8_t nVars_ = 0;
  float vars_[MAX_VARS];
};
