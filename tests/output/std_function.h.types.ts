import { functionPointer, functionT } from "./systemTypes.ts";

export const NullaryCallbackT = functionT;
export type NullaryCallbackPointer = functionPointer;

export const UnaryCallbackT = functionT;
export type UnaryCallbackPointer = functionPointer;

export const BinaryCallbackT = functionT;
export type BinaryCallbackPointer = functionPointer;

export const TernaryCallbackT = functionT;
export type TernaryCallbackPointer = functionPointer;

export const MY_CLASS_SIZE = 128 as const;
export const MyClassT = {
  struct: [
    NullaryCallbackT, // a_, offset 0, size 32, align 8
    UnaryCallbackT, // b_, offset 32, size 32, align 8
    BinaryCallbackT, // c_, offset 64, size 32, align 8
    TernaryCallbackT, // d_, offset 96, size 32, align 8
  ],
} as const;
declare const MyClass: unique symbol;
export type MyClassPointer = NonNullable<Deno.PointerValue> & {
  [MyClass]: unknown;
};
