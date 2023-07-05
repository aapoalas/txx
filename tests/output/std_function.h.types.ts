import {
  type Buf,
  buf,
  type functionPointer,
  functionT,
} from "./systemTypes.ts";

export const NULLARY_CALLBACK_SIZE = 32 as const;
export const NullaryCallbackT = functionT({ parameters: [], result: "void" });
export type NullaryCallbackPointer = functionPointer<
  Deno.UnsafeCallbackDefinition<[], "void">
>;

export const UNARY_CALLBACK_SIZE = 32 as const;
export const UnaryCallbackT = functionT({
  parameters: ["i32"],
  result: "void",
});
export type UnaryCallbackPointer = functionPointer<
  Deno.UnsafeCallbackDefinition<["i32"], "void">
>;

export const BINARY_CALLBACK_SIZE = 32 as const;
export const BinaryCallbackT = functionT({
  parameters: ["i32", "i32"],
  result: "void",
});
export type BinaryCallbackPointer = functionPointer<
  Deno.UnsafeCallbackDefinition<["i32", "i32"], "void">
>;

export const TERNARY_CALLBACK_SIZE = 32 as const;
export const TernaryCallbackT = functionT({
  parameters: ["i32", "i32", buf("self")],
  result: "void",
});
export type TernaryCallbackPointer = functionPointer<
  Deno.UnsafeCallbackDefinition<["i32", "i32", Buf<"self">], "void">
>;

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

export const POD_CLASS_SIZE = 4 as const;
export const PodClassT = {
  struct: [
    "i32", // data_, offset 0, size 4, align 4
  ],
} as const;
declare const PodClass: unique symbol;
export type PodClassPointer = NonNullable<Deno.PointerValue> & {
  [PodClass]: unknown;
};

export const OTHER_POD_CLASS_SIZE = 4 as const;
export const OtherPodClassT = {
  struct: [
    "i32", // data_, offset 0, size 4, align 4
  ],
} as const;
declare const OtherPodClass: unique symbol;
export type OtherPodClassPointer = NonNullable<Deno.PointerValue> & {
  [OtherPodClass]: unknown;
};

export const NON_POD_CLASS_SIZE = 4 as const;
export const NonPodClassT = {
  struct: [
    "i32", // data_, offset 0, size 4, align 4
  ],
} as const;
declare const NonPodClass: unique symbol;
export type NonPodClassPointer = NonNullable<Deno.PointerValue> & {
  [NonPodClass]: unknown;
};

export const ClassCallbackT = {
  parameters: [OtherPodClassT, NonPodClassT, buf(NonPodClassT)],
  result: "void",
} as const;
declare const ClassCallback_: unique symbol;
export type ClassCallback = NonNullable<Deno.PointerValue> & {
  [ClassCallback_]: unknown;
};
