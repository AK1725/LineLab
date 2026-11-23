import { z } from "zod";

/** Arduino-style fully qualified board names (FQBN) LineLab knows how to build for. */
export const Board = z.enum([
  "arduino:avr:uno",
  "arduino:avr:nano",
  "arduino:avr:mega",
  "arduino:avr:leonardo",
  "arduino:avr:micro",
  "arduino:avr:pro",
  "arduino:megaavr:nona4809",
  "arduino:samd:nano_33_iot",
  "rp2040:rp2040:rpipico",
  "rp2040:rp2040:rpipicow",
  "rp2040:rp2040:seeed_xiao_rp2040",
  "esp32:esp32:esp32",
  "esp32:esp32:esp32s3",
  "esp32:esp32:esp32c3",
  "stm32:stm32:bluepill_f103c8",
  "stm32:stm32:blackpill_f411ce",
  "teensy:avr:teensy40",
]);
export type Board = z.infer<typeof Board>;
