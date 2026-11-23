#pragma once
#include <stddef.h>
// A small Arduino-compatible String (heap from a bump allocator that is never freed: fine for
// sketches that build a few strings, not for ones that churn through thousands).
class String {
 public:
  String(const char* s = "");
  String(const String& o);
  String(char c);
  String(int v, int base = 10);
  String(unsigned int v, int base = 10);
  String(long v, int base = 10);
  String(unsigned long v, int base = 10);
  String(double v, int decimals = 2);
  String& operator=(const String& o);
  String& operator+=(const String& o);
  friend String operator+(const String& a, const String& b);
  bool operator==(const String& o) const;
  bool operator!=(const String& o) const { return !(*this == o); }
  char operator[](unsigned int i) const { return i < len_ ? buf_[i] : 0; }
  const char* c_str() const { return buf_; }
  unsigned int length() const { return len_; }
  long toInt() const;
  float toFloat() const;

 private:
  void assign(const char* s, size_t n);
  char* buf_;
  unsigned int len_;
};
