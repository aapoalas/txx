import {
  RtMidi__closePort,
  RtMidi__getPortCount,
  RtMidi__getPortName,
  RtMidi__MoveConstructor,
  RtMidi__openPort,
} from "./ffi.ts";
import {
  ALLOC_HIDER_SIZE,
  type allocatorPointer,
  type char_traitsPointer,
  MIDI_API_SIZE,
  RT_MIDI_SIZE,
  STRING_SIZE,
} from "./systemTypes.ts";

export class stringBuffer
  extends basic_stringBuffer<"i8", char_traitsPointer, allocatorPointer> {
  constructor(arg?: ArrayBufferLike | number) {
    if (typeof arg === "undefined") {
      super(STRING_SIZE);
      return;
    } else if (typeof arg === "number") {
      if (!Number.isFinite(arg) || arg < STRING_SIZE) {
        throw new Error(
          "Invalid construction of stringBuffer: Size is not finite or is too small",
        );
      }
      super(arg);
      return;
    }
    if (arg.byteLength < STRING_SIZE) {
      throw new Error(
        "Invalid construction of stringBuffer: Buffer size is too small",
      );
    }
    super(arg);
  }
}

export class basic_stringBuffer<_CharT, _Traits, _Alloc> extends Uint8Array {}

export class _Alloc_hiderBuffer extends allocator_type {
  constructor(arg?: ArrayBufferLike | number) {
    if (typeof arg === "undefined") {
      super(ALLOC_HIDER_SIZE);
      return;
    } else if (typeof arg === "number") {
      if (!Number.isFinite(arg) || arg < ALLOC_HIDER_SIZE) {
        throw new Error(
          "Invalid construction of _Alloc_hiderBuffer: Size is not finite or is too small",
        );
      }
      super(arg);
      return;
    }
    if (arg.byteLength < ALLOC_HIDER_SIZE) {
      throw new Error(
        "Invalid construction of _Alloc_hiderBuffer: Buffer size is too small",
      );
    }
    super(arg);
  }
}

export class RtMidiBuffer extends Uint8Array {
  constructor(arg?: ArrayBufferLike | number) {
    if (typeof arg === "undefined") {
      super(RT_MIDI_SIZE);
      return;
    } else if (typeof arg === "number") {
      if (!Number.isFinite(arg) || arg < RT_MIDI_SIZE) {
        throw new Error(
          "Invalid construction of RtMidiBuffer: Size is not finite or is too small",
        );
      }
      super(arg);
      return;
    }
    if (arg.byteLength < RT_MIDI_SIZE) {
      throw new Error(
        "Invalid construction of RtMidiBuffer: Buffer size is too small",
      );
    }
    super(arg);
  }

  static MoveConstructor(
    other: RtMidiBuffer,
    self = new RtMidiBuffer(),
  ): RtMidiBuffer {
    RtMidi__MoveConstructor(self, other);
    return self;
  }

  openPort(portNumber: number, portName: stringBuffer): void {
    return RtMidi__openPort(this, portNumber, portName);
  }

  getPortCount(): number {
    return RtMidi__getPortCount(this);
  }

  getPortName(portNumber: number): stringBuffer {
    return new stringBuffer(RtMidi__getPortName(this, portNumber).buffer);
  }

  closePort(): void {
    return RtMidi__closePort(this);
  }
}

export class MidiApiBuffer extends Uint8Array {
  constructor(arg?: ArrayBufferLike | number) {
    if (typeof arg === "undefined") {
      super(MIDI_API_SIZE);
      return;
    } else if (typeof arg === "number") {
      if (!Number.isFinite(arg) || arg < MIDI_API_SIZE) {
        throw new Error(
          "Invalid construction of MidiApiBuffer: Size is not finite or is too small",
        );
      }
      super(arg);
      return;
    }
    if (arg.byteLength < MIDI_API_SIZE) {
      throw new Error(
        "Invalid construction of MidiApiBuffer: Buffer size is too small",
      );
    }
    super(arg);
  }
}
