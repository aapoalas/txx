#include <functional>

typedef std::function<void()> NullaryCallback;
typedef std::function<void(int)> UnaryCallback;
typedef std::function<void(int, int)> BinaryCallback;

class MyClass {
  public:
  typedef std::function<void(int, int, MyClass &)> TernaryCallback;
  MyClass();

  private:
  NullaryCallback a_;
  UnaryCallback b_;
  BinaryCallback c_;
  TernaryCallback d_;
};

static int kValue = 3;