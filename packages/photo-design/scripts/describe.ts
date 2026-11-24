// What a vision model would plausibly say about each fixture part: what is visible on the real
// part (board colour, chip markings, size), never the database id. Hand-written; used as the
// SCRIPTED detector output in tests and demos.
export const DESCRIBE: Record<string, { description: string; markings: string[] }> = {
  "mcu.arduino-nano": {
    description: "Arduino Nano style board, blue PCB, mini-USB connector, two rows of 15 pins",
    markings: ["ATMEGA328P", "NANO"],
  },
  "mcu.arduino-uno-r3": {
    description: "Arduino Uno R3 board, teal PCB, USB-B and barrel jack, DIP chip in a socket",
    markings: ["UNO", "ATMEGA328P-PU"],
  },
  "mcu.esp32-devkitc": {
    description: "ESP32 dev board with a silver WROOM-32 module and micro-USB, 38 pins",
    markings: ["ESP32-WROOM-32", "ESP32"],
  },
  "mcu.raspberry-pi-pico": {
    description: "Raspberry Pi Pico, green board with castellated edges and micro-USB",
    markings: ["RP2040", "Raspberry Pi Pico"],
  },
  "mcu.arduino-pro-mini-5v": {
    description: "small blue Pro Mini board without USB, 16 MHz crystal",
    markings: ["Pro Mini", "ATMEGA328P", "16MHz"],
  },
  "driver.tb6612fng": {
    description: "small purple motor driver carrier with a TB6612FNG chip, 16 pins",
    markings: ["TB6612FNG"],
  },
  "driver.l9110s-module": {
    description: "small red dual motor driver module with two SOP-8 chips and two screw terminals",
    markings: ["L9110S"],
  },
  "driver.drv8833-pololu": {
    description: "tiny purple Pololu motor driver carrier",
    markings: ["DRV8833"],
  },
  "driver.drv8835-pololu": {
    description: "tiny purple Pololu dual motor driver carrier, 14 pins",
    markings: ["DRV8835"],
  },
  "driver.mx1508-module": {
    description: "tiny red dual DC motor driver module, 2 motor outputs",
    markings: ["MX1508"],
  },
  "sensor.pololu-qtr-8a": {
    description: "long thin line sensor array with 8 IR emitter/detector pairs, analog",
    markings: ["QTR-8A"],
  },
  "sensor.tcrt5000-5ch": {
    description: "5-channel TCRT5000 IR tracking module, blue board with 5 sensors in a row",
    markings: ["TCRT5000"],
  },
  "sensor.pololu-qtr-8rc": {
    description: "8 sensor reflectance array, Pololu QTR RC version",
    markings: ["QTR-8RC"],
  },
  "sensor.pololu-qtr-md-08a": {
    description: "Pololu QTR MD 8-channel reflectance sensor, 8 mm pitch, analog",
    markings: ["QTR-MD-08A"],
  },
  "sensor.tcrt5000-8ch-analog": {
    description: "8 channel analog TCRT5000 line sensor array board",
    markings: ["TCRT5000"],
  },
  "motor.pololu-hp-6v-30-1": {
    description: "two micro metal gearmotors, Pololu style, gearbox label 30:1 HP",
    markings: ["30:1 HP"],
  },
  "motor.tt-1-48": {
    description: "two yellow TT gear motors (plastic gearbox), dual shaft",
    markings: [],
  },
  "motor.tt-1-120": { description: "two yellow TT gearmotors, 1:120 gearbox", markings: ["1:120"] },
  "motor.n20-6v-500rpm": {
    description: "two N20 micro gear motors, metal gearbox, sticker 6V 500RPM",
    markings: ["N20", "500RPM"],
  },
  "motor.n20-6v-300rpm": {
    description: "two small N20 gearmotors, 300 rpm",
    markings: ["N20 300RPM"],
  },
  "wheel.pololu-32x7": {
    description: "two small black Pololu wheels about 32 mm with thin silicone tyres",
    markings: [],
  },
  "wheel.tt-65mm": {
    description: "two yellow-hub 65 mm rubber wheels for TT motors",
    markings: [],
  },
  "wheel.n20-34mm": {
    description: "two black rubber wheels about 34 mm for N20 D-shaft",
    markings: [],
  },
  "caster.nylon-skid": { description: "white nylon skid pad under the front", markings: [] },
  "caster.pololu-ball-3-4-metal": {
    description: "ball caster with a 3/4 inch metal ball",
    markings: [],
  },
  "battery.lipo-2s-300mah": {
    description: "small 2S LiPo pack 7.4V 300mAh with JST plug",
    markings: ["7.4V", "300mAh"],
  },
  "battery.lipo-2s-450mah": {
    description: "2S lipo battery 450mAh, 7.4 V",
    markings: ["450mAh", "2S"],
  },
  "battery.aa-4x-alkaline": { description: "battery holder with 4 AA cells", markings: ["4xAA"] },
  "regulator.pololu-d24v10f5": {
    description: "tiny green Pololu 5V step-down regulator board",
    markings: ["D24V10F5"],
  },
};
