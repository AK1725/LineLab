// good_pid.ino — a PID line follower for LineLab's reference robot:
// Arduino Nano + TB6612FNG + Pololu QTR-8A, motor A = left, motor B = right.
//
// Wiring (as auto-wired by LineLab):
//   QTR-8A OUT1..OUT8 -> A0..A7 (OUT1 is on the robot's left)
//   TB6612 PWMA D3, AIN1 D2, AIN2 D4   (left motor)
//          PWMB D5, BIN1 D7, BIN2 D8   (right motor)
//          STBY tied to 5 V

const uint8_t SENSORS[8] = {A0, A1, A2, A3, A4, A5, A6, A7};
const uint8_t PWMA = 3, AIN1 = 2, AIN2 = 4;
const uint8_t PWMB = 5, BIN1 = 7, BIN2 = 8;

// Error is -3500..3500 (line under sensor 8 .. sensor 1); positive = line to the left.
float Kp = 0.08;          // PWM counts per error unit
float Kd = 2.5;           // PWM counts per (error unit per ms)
int baseSpeed = 115;      // of 255

int lo = 1023, hi = 0;    // running calibration
long lastError = 0;
unsigned long lastMicros = 0, lastPrint = 0;

void setMotor(uint8_t pwm, uint8_t in1, uint8_t in2, int speed) {
  speed = constrain(speed, -255, 255);
  digitalWrite(in1, speed >= 0 ? HIGH : LOW);
  digitalWrite(in2, speed >= 0 ? LOW : HIGH);
  analogWrite(pwm, abs(speed));
}

void setup() {
  pinMode(PWMA, OUTPUT); pinMode(AIN1, OUTPUT); pinMode(AIN2, OUTPUT);
  pinMode(PWMB, OUTPUT); pinMode(BIN1, OUTPUT); pinMode(BIN2, OUTPUT);
  Serial.begin(115200);
  Serial.println(F("good_pid ready"));
  lastMicros = micros();
}

void loop() {
  int v[8];
  for (uint8_t i = 0; i < 8; i++) {
    v[i] = analogRead(SENSORS[i]);
    if (v[i] < lo) lo = v[i];
    if (v[i] > hi) hi = v[i];
  }
  int span = hi - lo;
  long sum = 0, weighted = 0;
  for (uint8_t i = 0; i < 8; i++) {
    long dark = span > 150 ? constrain((long)(v[i] - lo) * 1000 / span - 100, 0, 900) : 0;
    sum += dark;
    weighted += dark * (3500 - 1000L * i);
  }
  long error;
  bool lost = sum < 300;
  if (lost) error = lastError >= 0 ? 3500 : -3500;  // turn towards where the line was
  else error = weighted / sum;

  unsigned long now = micros();
  float dtMs = (now - lastMicros) / 1000.0;
  lastMicros = now;
  if (dtMs <= 0) dtMs = 1;
  float turn = Kp * error + Kd * (error - lastError) / dtMs;
  lastError = error;

  int base = lost ? 38 : baseSpeed - (int)(baseSpeed / 2 * min(abs(error), 3500L) / 3500);
  setMotor(PWMA, AIN1, AIN2, base - (int)turn);
  setMotor(PWMB, BIN1, BIN2, base + (int)turn);

  if (millis() - lastPrint >= 250) {
    lastPrint = millis();
    Serial.print(F("err "));
    Serial.println(error);
  }
}
