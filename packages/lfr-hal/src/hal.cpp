// Runtime for LineLab's simulated Arduino core. Hardware and time go to the JavaScript host through
// the imports in hal_imports.h; everything else (formatting, strings, memory) lives here.
#include <Arduino.h>
#include <stdarg.h>

// ---------------------------------------------------------------- libc subset

extern "C" {
void* memset(void* d, int c, size_t n) {
  unsigned char* p = (unsigned char*)d;
  while (n--) *p++ = (unsigned char)c;
  return d;
}
void* memcpy(void* d, const void* s, size_t n) {
  unsigned char* a = (unsigned char*)d;
  const unsigned char* b = (const unsigned char*)s;
  while (n--) *a++ = *b++;
  return d;
}
void* memmove(void* d, const void* s, size_t n) {
  unsigned char* a = (unsigned char*)d;
  const unsigned char* b = (const unsigned char*)s;
  if (a < b) {
    while (n--) *a++ = *b++;
  } else {
    a += n;
    b += n;
    while (n--) *--a = *--b;
  }
  return d;
}
int memcmp(const void* x, const void* y, size_t n) {
  const unsigned char* a = (const unsigned char*)x;
  const unsigned char* b = (const unsigned char*)y;
  for (; n; n--, a++, b++)
    if (*a != *b) return *a - *b;
  return 0;
}
size_t strlen(const char* s) {
  size_t n = 0;
  while (s[n]) n++;
  return n;
}
int strcmp(const char* a, const char* b) {
  while (*a && *a == *b) a++, b++;
  return (unsigned char)*a - (unsigned char)*b;
}
int strncmp(const char* a, const char* b, size_t n) {
  for (; n && *a && *a == *b; n--) a++, b++;
  return n ? (unsigned char)*a - (unsigned char)*b : 0;
}
char* strcpy(char* d, const char* s) {
  char* r = d;
  while ((*d++ = *s++)) {
  }
  return r;
}
char* strncpy(char* d, const char* s, size_t n) {
  size_t i = 0;
  for (; i < n && s[i]; i++) d[i] = s[i];
  for (; i < n; i++) d[i] = 0;
  return d;
}
char* strcat(char* d, const char* s) {
  strcpy(d + strlen(d), s);
  return d;
}

// Bump allocator over a static heap: free() is a no-op.
static unsigned char heap[256 * 1024];
static size_t heapTop = 0;
void* malloc(size_t n) {
  n = (n + 7) & ~(size_t)7;
  if (heapTop + n > sizeof(heap)) return 0;
  void* p = heap + heapTop;
  heapTop += n;
  return p;
}
void* calloc(size_t n, size_t size) {
  void* p = malloc(n * size);
  if (p) memset(p, 0, n * size);
  return p;
}
void* realloc(void* p, size_t n) {
  void* q = malloc(n);
  if (q && p) memcpy(q, p, n);  // may copy past the old block's end; harmless inside the heap
  return q;
}
void free(void* p) { (void)p; }
long atol(const char* s) {
  long v = 0;
  int sign = 1;
  while (*s == ' ') s++;
  if (*s == '-') sign = -1, s++;
  else if (*s == '+') s++;
  while (*s >= '0' && *s <= '9') v = v * 10 + (*s++ - '0');
  return sign * v;
}
int atoi(const char* s) { return (int)atol(s); }
double atof(const char* s) {
  double v = 0, f = 0.1;
  int sign = 1;
  while (*s == ' ') s++;
  if (*s == '-') sign = -1, s++;
  while (*s >= '0' && *s <= '9') v = v * 10 + (*s++ - '0');
  if (*s == '.')
    for (s++; *s >= '0' && *s <= '9'; s++, f /= 10) v += (*s - '0') * f;
  return sign * v;
}
void __cxa_pure_virtual() {}
int __cxa_atexit(void (*)(void*), void*, void*) { return 0; }
void* __dso_handle = 0;
}

void* operator new(size_t n) { return malloc(n); }
void* operator new[](size_t n) { return malloc(n); }
void operator delete(void* p) noexcept { free(p); }
void operator delete[](void* p) noexcept { free(p); }
void operator delete(void* p, size_t) noexcept { free(p); }
void operator delete[](void* p, size_t) noexcept { free(p); }

// ---------------------------------------------------------------- formatting

static int formatUnsigned(char* out, unsigned long v, int base) {
  char tmp[34];
  int n = 0;
  if (base < 2 || base > 16) base = 10;
  do {
    int d = (int)(v % (unsigned long)base);
    tmp[n++] = (char)(d < 10 ? '0' + d : 'A' + d - 10);
    v /= (unsigned long)base;
  } while (v);
  for (int i = 0; i < n; i++) out[i] = tmp[n - 1 - i];
  out[n] = 0;
  return n;
}

static int formatSigned(char* out, long v, int base) {
  if (v < 0 && base == 10) {
    out[0] = '-';
    return 1 + formatUnsigned(out + 1, (unsigned long)(-v), base);
  }
  return formatUnsigned(out, (unsigned long)v, base);
}

static int formatDouble(char* out, double v, int digits) {
  if (isnan(v)) return (int)strlen(strcpy(out, "nan"));
  if (isinf(v)) return (int)strlen(strcpy(out, v < 0 ? "-inf" : "inf"));
  int n = 0;
  if (v < 0) out[n++] = '-', v = -v;
  if (digits < 0) digits = 0;
  if (digits > 9) digits = 9;
  double r = 0.5;
  for (int i = 0; i < digits; i++) r /= 10;
  v += r;
  unsigned long ip = (unsigned long)v;
  n += formatUnsigned(out + n, ip, 10);
  if (digits > 0) {
    out[n++] = '.';
    double frac = v - (double)ip;
    for (int i = 0; i < digits; i++) {
      frac *= 10;
      int d = (int)frac;
      out[n++] = (char)('0' + d);
      frac -= d;
    }
  }
  out[n] = 0;
  return n;
}

// ---------------------------------------------------------------- GPIO, ADC, PWM, time

static int adcBits = LINELAB_ADC_BITS;
static int pwmBits = 8;

void pinMode(uint8_t pin, uint8_t mode) { hal_pin_mode(pin, mode); }
void digitalWrite(uint8_t pin, uint8_t value) { hal_digital_write(pin, value ? 1 : 0); }
int digitalRead(uint8_t pin) { return hal_digital_read(pin); }
void analogReadResolution(int bits) { adcBits = bits < 1 ? 1 : bits > 16 ? 16 : bits; }
int analogRead(uint8_t pin) {
  double f = hal_analog_read(pin);
  long full = (1L << adcBits) - 1;
  return (int)(f * full + 0.5);
}
void analogWriteResolution(int bits) { pwmBits = bits < 1 ? 1 : bits > 16 ? 16 : bits; }
void analogWrite(uint8_t pin, int value) {
  long full = (1L << pwmBits) - 1;
  hal_analog_write(pin, value <= 0 ? 0.0 : value >= full ? 1.0 : (double)value / (double)full);
}
unsigned long millis(void) { return (unsigned long)(uint32_t)(uint64_t)hal_millis(); }
unsigned long micros(void) { return (unsigned long)(uint32_t)(uint64_t)hal_micros(); }
void delay(unsigned long ms) { hal_delay((double)ms); }
void delayMicroseconds(unsigned int us) { hal_delay_us((double)us); }
void yield(void) { hal_delay_us(0); }
long map(long x, long inMin, long inMax, long outMin, long outMax) {
  if (inMax == inMin) return outMin;
  return (x - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}
long random(long max) { return max <= 0 ? 0 : (long)(hal_random() % (uint32_t)max); }
long random(long min, long max) { return max <= min ? min : min + random(max - min); }
void randomSeed(unsigned long seed) { (void)seed; }  // the simulator's seed decides

// LEDC: up to 16 channels; ledcWrite accepts a pin (core 3.x) or a channel (core 2.x).
static int8_t ledcPinOfChannel[16] = {-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1};
static uint8_t ledcBitsOfChannel[16];
static uint8_t ledcBitsOfPin[64];
static bool usesChannels = false;

bool ledcAttach(uint8_t pin, uint32_t freq, uint8_t resolution) {
  (void)freq;
  if (pin >= 64) return false;
  ledcBitsOfPin[pin] = resolution;
  hal_pin_mode(pin, OUTPUT);
  return true;
}
uint32_t ledcSetup(uint8_t channel, uint32_t freq, uint8_t resolution) {
  if (channel >= 16) return 0;
  usesChannels = true;
  ledcBitsOfChannel[channel] = resolution;
  return freq;
}
void ledcAttachPin(uint8_t pin, uint8_t channel) {
  if (channel >= 16) return;
  usesChannels = true;
  ledcPinOfChannel[channel] = (int8_t)pin;
  hal_pin_mode(pin, OUTPUT);
}
bool ledcWrite(uint8_t pinOrChannel, uint32_t duty) {
  int pin = pinOrChannel;
  int bits;
  if (usesChannels && pinOrChannel < 16 && ledcPinOfChannel[pinOrChannel] >= 0) {
    pin = ledcPinOfChannel[pinOrChannel];
    bits = ledcBitsOfChannel[pinOrChannel];
  } else {
    bits = pin < 64 ? ledcBitsOfPin[pin] : 0;
  }
  if (bits == 0) bits = 8;
  double full = (double)((1UL << bits) - 1);
  hal_analog_write(pin, duty >= full ? 1.0 : (double)duty / full);
  return true;
}

// ---------------------------------------------------------------- Serial

HardwareSerial Serial;
HardwareSerial Serial1;
HardwareSerial Serial2;

size_t HardwareSerial::write(uint8_t c) {
  hal_serial_write((const char*)&c, 1);
  return 1;
}
size_t HardwareSerial::write(const char* s) {
  size_t n = strlen(s);
  hal_serial_write(s, (int)n);
  return n;
}
size_t HardwareSerial::write(const uint8_t* buf, size_t n) {
  hal_serial_write((const char*)buf, (int)n);
  return n;
}
size_t HardwareSerial::print(const char* s) { return write(s); }
size_t HardwareSerial::print(const String& s) { return write(s.c_str()); }
size_t HardwareSerial::print(char c) { return write((uint8_t)c); }
size_t HardwareSerial::print(int v, int base) { return print((long)v, base); }
size_t HardwareSerial::print(unsigned int v, int base) { return print((unsigned long)v, base); }
size_t HardwareSerial::print(long v, int base) {
  char b[36];
  formatSigned(b, v, base);
  return write(b);
}
size_t HardwareSerial::print(unsigned long v, int base) {
  char b[36];
  formatUnsigned(b, v, base);
  return write(b);
}
size_t HardwareSerial::print(double v, int digits) {
  char b[48];
  formatDouble(b, v, digits);
  return write(b);
}
size_t HardwareSerial::println() { return write("\r\n"); }

size_t HardwareSerial::printf(const char* fmt, ...) {
  char out[256];
  int n = 0;
  va_list ap;
  va_start(ap, fmt);
  for (const char* p = fmt; *p && n < 200; p++) {
    if (*p != '%') {
      out[n++] = *p;
      continue;
    }
    p++;
    int prec = -1;
    bool isLong = false;
    while (*p >= '0' && *p <= '9') p++;  // width ignored
    if (*p == '.') {
      prec = 0;
      for (p++; *p >= '0' && *p <= '9'; p++) prec = prec * 10 + (*p - '0');
    }
    while (*p == 'l') isLong = true, p++;
    switch (*p) {
      case 'd':
      case 'i':
        n += formatSigned(out + n, isLong ? va_arg(ap, long) : va_arg(ap, int), 10);
        break;
      case 'u':
        n += formatUnsigned(out + n, isLong ? va_arg(ap, unsigned long) : va_arg(ap, unsigned int), 10);
        break;
      case 'x':
      case 'X':
        n += formatUnsigned(out + n, isLong ? va_arg(ap, unsigned long) : va_arg(ap, unsigned int), 16);
        break;
      case 'f':
        n += formatDouble(out + n, va_arg(ap, double), prec < 0 ? 6 : prec);
        break;
      case 'c':
        out[n++] = (char)va_arg(ap, int);
        break;
      case 's': {
        const char* s = va_arg(ap, const char*);
        while (*s && n < 240) out[n++] = *s++;
        break;
      }
      case '%':
        out[n++] = '%';
        break;
      default:
        break;
    }
  }
  va_end(ap);
  hal_serial_write(out, n);
  return (size_t)n;
}

// ---------------------------------------------------------------- String

void String::assign(const char* s, size_t n) {
  buf_ = (char*)malloc(n + 1);
  if (!buf_) {
    static char empty[1] = {0};
    buf_ = empty;
    len_ = 0;
    return;
  }
  memcpy(buf_, s, n);
  buf_[n] = 0;
  len_ = (unsigned int)n;
}
String::String(const char* s) { assign(s ? s : "", s ? strlen(s) : 0); }
String::String(const String& o) { assign(o.buf_, o.len_); }
String::String(char c) { assign(&c, 1); }
String::String(int v, int base) {
  char b[36];
  assign(b, (size_t)formatSigned(b, v, base));
}
String::String(unsigned int v, int base) {
  char b[36];
  assign(b, (size_t)formatUnsigned(b, v, base));
}
String::String(long v, int base) {
  char b[36];
  assign(b, (size_t)formatSigned(b, v, base));
}
String::String(unsigned long v, int base) {
  char b[36];
  assign(b, (size_t)formatUnsigned(b, v, base));
}
String::String(double v, int decimals) {
  char b[48];
  assign(b, (size_t)formatDouble(b, v, decimals));
}
String& String::operator=(const String& o) {
  if (this != &o) assign(o.buf_, o.len_);
  return *this;
}
String& String::operator+=(const String& o) {
  char* b = (char*)malloc(len_ + o.len_ + 1);
  if (!b) return *this;
  memcpy(b, buf_, len_);
  memcpy(b + len_, o.buf_, o.len_ + 1);
  buf_ = b;
  len_ += o.len_;
  return *this;
}
String operator+(const String& a, const String& b) {
  String r(a);
  r += b;
  return r;
}
bool String::operator==(const String& o) const { return len_ == o.len_ && memcmp(buf_, o.buf_, len_) == 0; }
long String::toInt() const { return atol(buf_); }
float String::toFloat() const { return (float)atof(buf_); }

// ---------------------------------------------------------------- start-up

extern "C" void __wasm_call_ctors(void);
/** Called once by the host before setup(): runs global constructors. */
extern "C" void hal_init(void) { __wasm_call_ctors(); }
