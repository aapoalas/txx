import { FUNCTION_BASE_SIZE } from "./systemTypes.ts";

export class _Function_baseBuffer extends Uint8Array {
  constructor(arg?: ArrayBufferLike | number) {
    if (typeof arg === "undefined") {
      super(FUNCTION_BASE_SIZE);
      return;
    } else if (typeof arg === "number") {
      if (!Number.isFinite(arg) || arg < FUNCTION_BASE_SIZE) {
        throw new Error(
          "Invalid construction of _Function_baseBuffer: Size is not finite or is too small",
        );
      }
      super(arg);
      return;
    }
    if (arg.byteLength < FUNCTION_BASE_SIZE) {
      throw new Error(
        "Invalid construction of _Function_baseBuffer: Buffer size is too small",
      );
    }
    super(arg);
  }
}

export class functionBuffer<_Signature extends Deno.UnsafeCallbackDefinition>
  extends Uint8Array {}
