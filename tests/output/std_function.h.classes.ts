import { MyClass__Constructor, PodClass__create } from "./ffi.ts";
import {
  BINARY_CALLBACK_SIZE,
  MY_CLASS_SIZE,
  NON_POD_CLASS_SIZE,
  NULLARY_CALLBACK_SIZE,
  OTHER_POD_CLASS_SIZE,
  POD_CLASS_SIZE,
  type PodClassPointer,
  TERNARY_CALLBACK_SIZE,
  UNARY_CALLBACK_SIZE,
} from "./std_function.h.types.ts";

export class NullaryCallbackBuffer extends Uint8Array {
  constructor(arg?: ArrayBufferLike | number) {
    if (typeof arg === "undefined") {
      super(NULLARY_CALLBACK_SIZE);
      return;
    } else if (typeof arg === "number") {
      if (!Number.isFinite(arg) || arg < NULLARY_CALLBACK_SIZE) {
        throw new Error(
          "Invalid construction of NullaryCallbackBuffer: Size is not finite or is too small",
        );
      }
      super(arg);
      return;
    }
    if (arg.byteLength < NULLARY_CALLBACK_SIZE) {
      throw new Error(
        "Invalid construction of NullaryCallbackBuffer: Buffer size is too small",
      );
    }
    super(arg);
  }
}

export class UnaryCallbackBuffer extends Uint8Array {
  constructor(arg?: ArrayBufferLike | number) {
    if (typeof arg === "undefined") {
      super(UNARY_CALLBACK_SIZE);
      return;
    } else if (typeof arg === "number") {
      if (!Number.isFinite(arg) || arg < UNARY_CALLBACK_SIZE) {
        throw new Error(
          "Invalid construction of UnaryCallbackBuffer: Size is not finite or is too small",
        );
      }
      super(arg);
      return;
    }
    if (arg.byteLength < UNARY_CALLBACK_SIZE) {
      throw new Error(
        "Invalid construction of UnaryCallbackBuffer: Buffer size is too small",
      );
    }
    super(arg);
  }
}

export class BinaryCallbackBuffer extends Uint8Array {
  constructor(arg?: ArrayBufferLike | number) {
    if (typeof arg === "undefined") {
      super(BINARY_CALLBACK_SIZE);
      return;
    } else if (typeof arg === "number") {
      if (!Number.isFinite(arg) || arg < BINARY_CALLBACK_SIZE) {
        throw new Error(
          "Invalid construction of BinaryCallbackBuffer: Size is not finite or is too small",
        );
      }
      super(arg);
      return;
    }
    if (arg.byteLength < BINARY_CALLBACK_SIZE) {
      throw new Error(
        "Invalid construction of BinaryCallbackBuffer: Buffer size is too small",
      );
    }
    super(arg);
  }
}

export class TernaryCallbackBuffer extends Uint8Array {
  constructor(arg?: ArrayBufferLike | number) {
    if (typeof arg === "undefined") {
      super(TERNARY_CALLBACK_SIZE);
      return;
    } else if (typeof arg === "number") {
      if (!Number.isFinite(arg) || arg < TERNARY_CALLBACK_SIZE) {
        throw new Error(
          "Invalid construction of TernaryCallbackBuffer: Size is not finite or is too small",
        );
      }
      super(arg);
      return;
    }
    if (arg.byteLength < TERNARY_CALLBACK_SIZE) {
      throw new Error(
        "Invalid construction of TernaryCallbackBuffer: Buffer size is too small",
      );
    }
    super(arg);
  }
}

export class MyClassBuffer extends Uint8Array {
  constructor(arg?: ArrayBufferLike | number) {
    if (typeof arg === "undefined") {
      super(MY_CLASS_SIZE);
      return;
    } else if (typeof arg === "number") {
      if (!Number.isFinite(arg) || arg < MY_CLASS_SIZE) {
        throw new Error(
          "Invalid construction of MyClassBuffer: Size is not finite or is too small",
        );
      }
      super(arg);
      return;
    }
    if (arg.byteLength < MY_CLASS_SIZE) {
      throw new Error(
        "Invalid construction of MyClassBuffer: Buffer size is too small",
      );
    }
    super(arg);
  }

  static Constructor(self = new MyClassBuffer()): MyClassBuffer {
    MyClass__Constructor(self);
    return self;
  }
}

export class PodClassBuffer extends Uint8Array {
  constructor(arg?: ArrayBufferLike | number) {
    if (typeof arg === "undefined") {
      super(POD_CLASS_SIZE);
      return;
    } else if (typeof arg === "number") {
      if (!Number.isFinite(arg) || arg < POD_CLASS_SIZE) {
        throw new Error(
          "Invalid construction of PodClassBuffer: Size is not finite or is too small",
        );
      }
      super(arg);
      return;
    }
    if (arg.byteLength < POD_CLASS_SIZE) {
      throw new Error(
        "Invalid construction of PodClassBuffer: Buffer size is too small",
      );
    }
    super(arg);
  }

  static create(): null | PodClassPointer {
    return PodClass__create() as null | PodClassPointer;
  }
}

export class OtherPodClassBuffer extends Uint8Array {
  constructor(arg?: ArrayBufferLike | number) {
    if (typeof arg === "undefined") {
      super(OTHER_POD_CLASS_SIZE);
      return;
    } else if (typeof arg === "number") {
      if (!Number.isFinite(arg) || arg < OTHER_POD_CLASS_SIZE) {
        throw new Error(
          "Invalid construction of OtherPodClassBuffer: Size is not finite or is too small",
        );
      }
      super(arg);
      return;
    }
    if (arg.byteLength < OTHER_POD_CLASS_SIZE) {
      throw new Error(
        "Invalid construction of OtherPodClassBuffer: Buffer size is too small",
      );
    }
    super(arg);
  }
}

export class NonPodClassBuffer extends Uint8Array {
  constructor(arg?: ArrayBufferLike | number) {
    if (typeof arg === "undefined") {
      super(NON_POD_CLASS_SIZE);
      return;
    } else if (typeof arg === "number") {
      if (!Number.isFinite(arg) || arg < NON_POD_CLASS_SIZE) {
        throw new Error(
          "Invalid construction of NonPodClassBuffer: Size is not finite or is too small",
        );
      }
      super(arg);
      return;
    }
    if (arg.byteLength < NON_POD_CLASS_SIZE) {
      throw new Error(
        "Invalid construction of NonPodClassBuffer: Buffer size is too small",
      );
    }
    super(arg);
  }
}
