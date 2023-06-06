import { functionT } from "./systemTypes.ts";

export const NULLARY_CALLBACK_SIZE = 32 as const;
export const NullaryCallbackT = { struct: [functionT(type-parameter-0-0 (type-parameter-0-1...)), { struct: [] }] } as const;
declare const NullaryCallback: unique symbol;
export type NullaryCallbackPointer = NonNullable<Deno.PointerValue> & { [NullaryCallback]: unknown };

export const UNARY_CALLBACK_SIZE = 32 as const;
export const UnaryCallbackT = { struct: [functionT(type-parameter-0-0 (type-parameter-0-1...)), { struct: [] }] } as const;
declare const UnaryCallback: unique symbol;
export type UnaryCallbackPointer = NonNullable<Deno.PointerValue> & { [UnaryCallback]: unknown };

export const BINARY_CALLBACK_SIZE = 32 as const;
export const BinaryCallbackT = { struct: [functionT(type-parameter-0-0 (type-parameter-0-1...)), { struct: [] }] } as const;
declare const BinaryCallback: unique symbol;
export type BinaryCallbackPointer = NonNullable<Deno.PointerValue> & { [BinaryCallback]: unknown };

export const TERNARY_CALLBACK_SIZE = 32 as const;
export const TernaryCallbackT = { struct: [functionT(type-parameter-0-0 (type-parameter-0-1...)), { struct: [] }] } as const;
declare const TernaryCallback: unique symbol;
export type TernaryCallbackPointer = NonNullable<Deno.PointerValue> & { [TernaryCallback]: unknown };

export const MY_CLASS_SIZE = 128 as const;
export const MyClassT = {
  struct: [
NullaryCallbackT, // a_, offset 0, size 32, align 8
UnaryCallbackT, // b_, offset 32, size 32, align 8
BinaryCallbackT, // c_, offset 64, size 32, align 8
TernaryCallbackT, // d_, offset 96, size 32, align 8
  ]
} as const;
declare const MyClass: unique symbol;
export type MyClassPointer = NonNullable<Deno.PointerValue> & { [MyClass]: unknown };
