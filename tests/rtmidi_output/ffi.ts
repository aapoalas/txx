import * as SYSTEMBINDINGS.TS from "./systemBindings.ts";
  
const lib = Deno.dlopen("FFIPATH", {
  ...SYSTEMBINDINGS.TS
  });;

export const RtMidi__MoveConstructor = lib.symbols.RtMidi__MoveConstructor;
export const RtMidi__openPort = lib.symbols.RtMidi__openPort;
export const RtMidi__getPortCount = lib.symbols.RtMidi__getPortCount;
export const RtMidi__getPortName = lib.symbols.RtMidi__getPortName;
export const RtMidi__closePort = lib.symbols.RtMidi__closePort;