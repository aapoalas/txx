import { buf, RtMidiT, stringT } from "./systemTypes.ts";

export const RtMidi__MoveConstructor = {
  name: "undefined",
  parameters: [buf(RtMidiT), buf(RtMidiT)],
  result: "void",
} as const;

export const RtMidi__openPort = {
  name:
    "_ZN6RtMidi8openPortEjRKNSt7__cxx1112basic_stringIcSt11char_traitsIcESaIcEEE",
  parameters: [buf(RtMidiT), "u32", buf(stringT)],
  result: "void",
} as const;

export const RtMidi__getPortCount = {
  name: "_ZN6RtMidi12getPortCountEv",
  parameters: [buf(RtMidiT)],
  result: "u32",
} as const;

export const RtMidi__getPortName = {
  name: "_ZN6RtMidi11getPortNameB5cxx11Ej",
  parameters: [buf(RtMidiT), "u32"],
  result: stringT,
} as const;

export const RtMidi__closePort = {
  name: "_ZN6RtMidi9closePortEv",
  parameters: [buf(RtMidiT)],
  result: "void",
} as const;
