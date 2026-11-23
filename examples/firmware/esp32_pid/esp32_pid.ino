// esp32_pid.ino — PID line follower for the ESP32 version of LineLab's reference robot
// (ESP32 DevKitC + TB6612FNG + QTR-8A, wired by LineLab's auto-wire).
// Runs in LineLab on the HAL tier: approximate timing, no real timers.

const int SENSORS[8] = {36, 39, 34, 35, 32, 33, 25, 26};  // OUT1 (left) .. OUT8
const int PWMA = 16, AIN1 = 18, AIN2 = 19;  // left motor
const int PWMB = 17, BIN1 = 21, BIN2 = 22;  // right motor

const float Kp = 0.08f;   // PWM counts per error unit (error is -3500..3500)
const float Kd = 2.5f;    // PWM counts per (error unit per ms)
const int BASE = 115;

int lo = 4095, hi = 0;
long lastError = 0;
unsigned long lastMicros = 0, lastPrint = 0;

void drive(int pwmPin, int in1, int in2, int speed) {
  speed = constrain(speed, -255, 255);
  digitalWrite(in1, speed >= 0 ? HIGH : LOW);
  digitalWrite(in2, speed >= 0 ? LOW : HIGH);
  ledcWrite(pwmPin, abs(speed));
}

void setup() {
  Serial.begin(115200);
  pinMode(AIN1, OUTPUT); pinMode(AIN2, OUTPUT);
  pinMode(BIN1, OUTPUT); pinMode(BIN2, OUTPUT);
  ledcAttach(PWMA, 20000, 8);
  ledcAttach(PWMB, 20000, 8);
  Serial.println("esp32_pid ready");
  lastMicros = micros();
}

void loop() {
  int v[8];
  for (int i = 0; i < 8; i++) {
    v[i] = analogRead(SENSORS[i]);
    lo = min(lo, v[i]);
    hi = max(hi, v[i]);
  }
  int span = hi - lo;
  long sum = 0, weighted = 0;
  for (int i = 0; i < 8; i++) {
    long dark = span > 600 ? constrain((long)(v[i] - lo) * 1000 / span - 100, 0L, 900L) : 0;
    sum += dark;
    weighted += dark * (3500 - 1000L * i);
  }
  bool lost = sum < 300;
  long error = lost ? (lastError >= 0 ? 3500 : -3500) : weighted / sum;

  unsigned long now = micros();
  float dtMs = (now - lastMicros) / 1000.0f;
  lastMicros = now;
  if (dtMs <= 0) dtMs = 1;
  float turn = Kp * error + Kd * (error - lastError) / dtMs;
  lastError = error;

  int base = lost ? 38 : BASE - (int)(BASE / 2 * min(labs(error), 3500L) / 3500);
  drive(PWMA, AIN1, AIN2, base - (int)turn);
  drive(PWMB, BIN1, BIN2, base + (int)turn);

  if (millis() - lastPrint >= 250) {
    lastPrint = millis();
    Serial.printf("err %ld\n", error);
  }
  delay(1);  // ~1 kHz control loop
}
