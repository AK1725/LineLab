// blink.ino — toggles the Nano's on-board LED (D13) every 500 ms.
// LineLab uses it to check emulated timing: each toggle must land within 1 % of 500 ms.
void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  delay(500);
}
