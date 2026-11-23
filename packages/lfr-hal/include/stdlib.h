#pragma once
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif
void* malloc(size_t n);
void* calloc(size_t n, size_t size);
void* realloc(void* p, size_t n);
void free(void* p);
long atol(const char* s);
int atoi(const char* s);
double atof(const char* s);
#ifdef __cplusplus
}
#endif
static inline int abs(int x) { return x < 0 ? -x : x; }
static inline long labs(long x) { return x < 0 ? -x : x; }
