import { MyClassT } from "./std_function.h.types.ts";
import { buf } from "./systemTypes.ts";

export const MyClass__Constructor = {
  name: "_ZN7MyClassC1Ev",
  parameters: [buf(MyClassT)],
  result: "void",
} as const;

export const kValue = {
  name: "_ZL6kValue",
  type: "i32",
} as const;
