import {
  ClassCallbackT,
  MyClassT,
  NonPodClassT,
  OtherPodClassT,
  PodClassT,
} from "./std_function.h.types.ts";
import { buf, func, ptr } from "./systemTypes.ts";

export const MyClass__Constructor = {
  name: "_ZN7MyClassC1Ev",
  parameters: [buf(MyClassT)],
  result: "void",
} as const;

export const PodClass__create = {
  name: "_ZN8PodClass6createEv",
  parameters: [],
  result: ptr(PodClassT),
} as const;

export const tryFunction = {
  name:
    "_Z11tryFunctionPFv13OtherPodClass11NonPodClassRS0_E8PodClassRS4_S_RS_S0_S1_",
  parameters: [
    func(ClassCallbackT),
    PodClassT,
    ptr(PodClassT),
    OtherPodClassT,
    buf(OtherPodClassT),
    buf(NonPodClassT),
    buf(NonPodClassT),
  ],
  result: "void",
} as const;

export const kValue = {
  name: "_ZL6kValue",
  type: "i32",
} as const;
