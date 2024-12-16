declare const BufBrand: unique symbol;
export type Buf<T> = "buffer" & { [BufBrand]: T };
export const buf = <T>(_: T) => "buffer" as Buf<T>;

declare const FuncBrand: unique symbol;
export type Func<T> = "function" & { [FuncBrand]: T };
export const func = <T>(_: T) => "function" as Func<T>;

namespace std {
  type __void_t<_Tp> = void;

  declare const BIND_SYMBOL: unique symbol;
  type _Bind<T> = { [BIND_SYMBOL]: T };
  type __rebind<_Tp, _Up> = _Tp extends { rebind<T>(p: T): infer Ret extends _Bind<T> } ? { type: Ret<_Up> } : 4;

  abstract class _BindC {
    abstract rebind: _Bind<T>;
  }

  interface Rebindable {
    rebind<T>(): _Bind<T>;
  }
  type Foo = __rebind<Rebindable, 6>;

  interface __allocator_traits_base<_Tp, _Up, _ = void> {
    
  }
  interface allocator<T> {
  }

  interface __ptr_traits_elem<_Ptr> {}

  interface _SingleParamType<T> {
  }

  interface _TwoParamsType<T, U> extends _SingleParamType<T> {
  }

  type _OneOrMoreParamsType<T, Rest = never> = _SingleParamType<T> | _TwoParamsType<T, Rest>;

  type __replace_first_arg<_Tp, _Up, _Types = never, _Template = (a: _Tp) => unknown> = _Template extends (a: _Tp, ...rest: _Types[]) => infer Return ? { type: Parameters<_Template> } : {};

  namespace pointer_traits {
    export type __difference_type<_Tp> = _Tp extends { difference_type: infer T } ? T : never;
    
    export type __rebind<_Tp, _Up, _ = void> = __replace_first_arg<_Tp, _Up> & (_Tp extends { rebind: infer Rebind } ? _ extends __void_t<_Tp> ? { type: Rebind } : never : never)
  }

  interface pointer_traits<_Ptr> extends __ptr_traits_elem<_Ptr> {
    pointer: _Ptr;
    difference_type: pointer_traits.__difference_type<_Ptr>;
    rebind<_Up>(_up: _Up): pointer_traits.__rebind<_Ptr, _Up>["type"];
  }

  type allocator_traits<_Tp> = 
}
export const CHAR_TRAITS_SIZE = 1 as const;
export const char_traitsT = {
  struct: [
    
  ]
} as const;
declare const char_traits: unique symbol;
export type char_traitsPointer = NonNullable<Deno.PointerValue> & { [char_traits]: unknown };

export const ALLOCATOR_SIZE = 1 as const;
export const allocatorT = {
  struct: [
    
  ]
} as const;
declare const allocator: unique symbol;
export type allocatorPointer = NonNullable<Deno.PointerValue> & { [allocator]: unknown };

export const _Char_alloc_typeT = TypenameGnuCxxAllocTraitsAllocTemplateRebindCharTOther;
export type _Char_alloc_type = typename __gnu_cxx::__alloc_traits<_Alloc>::template rebind<_CharT>::other;

export const allocator_typeT = _Char_alloc_typeT;
export type allocator_type = _Char_alloc_type;

export const pointerT = TypenameAllocTraitsPointer;
export type pointer = typename _Alloc_traits::pointer;

export const ALLOC_HIDER_SIZE = -3 as const;
export const _Alloc_hiderT = {
  struct: [
    allocator_typeT, // base class, size -3, align -3
    pointerT, // _M_p
  ]
} as const;
declare const _Alloc_hider: unique symbol;
export type _Alloc_hiderPointer = NonNullable<Deno.PointerValue> & { [_Alloc_hider]: unknown };

export const size_typeT = TypenameAllocTraitsSizeType;
export type size_type = typename _Alloc_traits::size_type;

declare const basic_stringTemplate: unique symbol;
declare const basic_string__CharT: unique symbol;
declare const basic_string__Traits: unique symbol;
declare const basic_string__Alloc: unique symbol;
export type basic_stringPointer<CharT, Traits, Alloc> = NonNullable<Deno.PointerValue> & { [basic_stringTemplate]: unknown; [basic_string__CharT]: CharT; [basic_string__Traits]: Traits; [basic_string__Alloc]: Alloc; };
export const basic_stringT = <const CharT, const Traits, const Alloc>(
    charT: CharT
    traits: Traits
    alloc: Alloc
) => {
  const charT = _CharT;
const traits = _Traits;
const alloc = _Alloc;
  return { struct: [
    _Alloc_hiderT, // _M_dataplus
    size_typeT, // _M_string_length
] } as const;
};

export const STRING_SIZE = 32 as const;
export const stringT = basic_stringT("i8", char_traitsT, allocatorT);
export type stringPointer = basic_stringPointer<"i8", char_traitsPointer, allocatorPointer>;

export const TypeT = "u32";
export const enum Type {
   WARNING,
   DEBUG_WARNING,
   UNSPECIFIED,
   NO_DEVICES_FOUND,
   INVALID_DEVICE,
   MEMORY_ERROR,
   INVALID_PARAMETER,
   INVALID_USE,
   DRIVER_ERROR,
   SYSTEM_ERROR,
   THREAD_ERROR,
}

export const RtMidiErrorCallbackT = { parameters: [TypeT, buf(stringT), "pointer"], result: "void" } as const;
declare const RtMidiErrorCallback_: unique symbol;
export type RtMidiErrorCallback = NonNullable<Deno.PointerValue> & { [RtMidiErrorCallback_]: unknown };

export const MIDI_API_SIZE = 80 as const;
export const MidiApiT = {
  struct: [
    "pointer", // vtable
    "pointer", // apiData_, offset 8, size 8, align 8
    "bool", // connected_, offset 16, size 1, align 1
    stringT, // errorString_, offset 24, size 32, align 8
    func(RtMidiErrorCallbackT), // errorCallback_, offset 56, size 8, align 8
    "bool", // firstErrorOccurred_, offset 64, size 1, align 1
    "pointer", // errorCallbackUserData_, offset 72, size 8, align 8
  ]
} as const;
declare const MidiApi: unique symbol;
export type MidiApiPointer = NonNullable<Deno.PointerValue> & { [MidiApi]: unknown };

export const RT_MIDI_SIZE = 16 as const;
export const RtMidiT = {
  struct: [
    "pointer", // vtable
    buf(MidiApiT), // rtapi_, offset 8, size 8, align 8
  ]
} as const;
declare const RtMidi: unique symbol;
export type RtMidiPointer = NonNullable<Deno.PointerValue> & { [RtMidi]: unknown };
