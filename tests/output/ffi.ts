import * as STD_FUNCTION from "./std_function.h.ts";

const lib = Deno.dlopen("FFIPATH", {
  ...STD_FUNCTION,
});
