#pragma once
// Math for the HAL build: wasm instructions where they exist, the host's Math.* otherwise.
#ifdef __cplusplus
extern "C" {
#endif
double sin(double);
double cos(double);
double tan(double);
double asin(double);
double acos(double);
double atan(double);
double atan2(double, double);
double exp(double);
double log(double);
double log10(double);
double pow(double, double);
double fmod(double, double);
#ifdef __cplusplus
}
#endif
static inline double sqrt(double x) { return __builtin_sqrt(x); }
static inline double fabs(double x) { return __builtin_fabs(x); }
static inline double floor(double x) { return __builtin_floor(x); }
static inline double ceil(double x) { return __builtin_ceil(x); }
static inline double trunc(double x) { return __builtin_trunc(x); }
static inline float sqrtf(float x) { return __builtin_sqrtf(x); }
static inline float fabsf(float x) { return __builtin_fabsf(x); }
static inline float floorf(float x) { return __builtin_floorf(x); }
static inline float ceilf(float x) { return __builtin_ceilf(x); }
static inline float sinf(float x) { return (float)sin(x); }
static inline float cosf(float x) { return (float)cos(x); }
static inline float atan2f(float y, float x) { return (float)atan2(y, x); }
static inline float powf(float a, float b) { return (float)pow(a, b); }
static inline float expf(float x) { return (float)exp(x); }
static inline double fmin(double a, double b) { return a < b ? a : b; }
static inline double fmax(double a, double b) { return a > b ? a : b; }
static inline long lround(double x) { return (long)(x < 0 ? x - 0.5 : x + 0.5); }
static inline double hypot(double a, double b) { return sqrt(a * a + b * b); }
#define M_PI 3.14159265358979323846
#define isnan(x) __builtin_isnan(x)
#define isinf(x) __builtin_isinf(x)
