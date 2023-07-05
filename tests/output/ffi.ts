import * as STD_FUNCTION from "./std_function.h.ts";

const lib = Deno.dlopen("FFIPATH", {
  ...STD_FUNCTION,
});

export const MyClass__Constructor = lib.symbols.MyClass__Constructor;
export const PodClass__create = lib.symbols.PodClass__create;
export const tryFunction = lib.symbols.tryFunction;
