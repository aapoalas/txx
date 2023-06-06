#include <functional>

typedef std::function<void()> NullaryCallback;
typedef std::function<void(int)> UnaryCallback;
typedef std::function<void(int, int)> BinaryCallback;
typedef std::function<void(int, int, int)> TernaryCallback;

class MyClass {
  NullaryCallback a_;
  UnaryCallback b_;
  BinaryCallback c_;
  TernaryCallback d_;
};