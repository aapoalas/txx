import { MY_CLASS_SIZE } from "./std_function.h.types.ts";
import { functionBuffer } from "./systemClasses.ts";

export const NullaryCallbackBuffer = functionBuffer;

export const UnaryCallbackBuffer = functionBuffer;

export const BinaryCallbackBuffer = functionBuffer;

export const TernaryCallbackBuffer = functionBuffer;

export class MyClassBuffer extends Uint8Array {
  constructor(arg?: ArrayBufferLike | number) {
    if (typeof arg === "undefined") {
      super(MY_CLASS_SIZE);
    } else if (typeof arg === "number") {
      if (!Number.isFinite(arg) || arg < MY_CLASS_SIZE) {
        throw new Error(
          "Invalid construction of MyClassBuffer: Size is not finite or is too small",
        );
      }
      super(arg);
    } else {
      if (arg.byteLength < MY_CLASS_SIZE) {
        throw new Error(
          "Invalid construction of MyClassBuffer: Buffer size is too small",
        );
      }
      super(arg);
    }
  }
}
