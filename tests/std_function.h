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

class PodClass {
  public:
  static PodClass* create();

  private:
  int data_;
};

class OtherPodClass {
  int data_{6};
};

class NonPodClass {
  private:
  int data_;
  ~NonPodClass();
};

typedef void (*ClassCallback)(OtherPodClass, NonPodClass, NonPodClass&);

void tryFunction(ClassCallback cb, PodClass, PodClass&, OtherPodClass, OtherPodClass&, NonPodClass, NonPodClass&);

static int kValue = 3;