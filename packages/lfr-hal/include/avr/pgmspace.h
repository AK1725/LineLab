#pragma once
// No separate program memory on the HAL: PROGMEM data is ordinary data.
#define PROGMEM
#define PGM_P const char*
#define pgm_read_byte(p) (*(const unsigned char*)(p))
#define pgm_read_word(p) (*(const unsigned short*)(p))
#define pgm_read_dword(p) (*(const unsigned long*)(p))
#define pgm_read_float(p) (*(const float*)(p))
