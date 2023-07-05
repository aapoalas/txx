export const union3 = <const T, const U, const V>(
  a: T,
  _b: U,
  _c: V,
): T | U | V => a;

export const union2 = <const T, const U>(a: T, _b: U): T | U => a;

declare const PtrBrand: unique symbol;
export type Ptr<T> = "pointer" & { [PtrBrand]: T };
export const ptr = <T>(_: T) => "pointer" as Ptr<T>;

declare const FuncBrand: unique symbol;
export type Func<T> = "function" & { [FuncBrand]: T };
export const func = <T>(_: T) => "function" as Func<T>;

declare const BufBrand: unique symbol;
export type Buf<T> = "buffer" & { [BufBrand]: T };
export const buf = <T>(_: T) => "buffer" as Buf<T>;

export const _Nocopy_typesT = union3(
  { "struct": ["u64", "u64"] },
  "pointer",
  func({ parameters: [], result: "void" }),
);
export const _Any_dataT = union2(
  _Nocopy_typesT,
  {
    struct: [
      "i8",
      "i8",
      "i8",
      "i8",
      "i8",
      "i8",
      "i8",
      "i8",
      "i8",
      "i8",
      "i8",
      "i8",
      "i8",
      "i8",
      "i8",
      "i8",
    ],
  },
);
export const _Manager_operationT = "u32";
export const enum _Manager_operation {
  __get_type_info,
  __get_functor_ptr,
  __clone_functor,
  __destroy_functor,
}

export const _Manager_typeT = {
  parameters: [ptr(_Any_dataT), ptr(_Any_dataT), _Manager_operationT],
  result: "bool",
} as const;
declare const _Manager_type_: unique symbol;
export type _Manager_type = NonNullable<Deno.PointerValue> & {
  [_Manager_type_]: unknown;
};

export const FUNCTION_BASE_SIZE = 24 as const;
export const _Function_baseT = {
  struct: [
    _Any_dataT, // _M_functor, offset 0, size 16, align 8
    func(_Manager_typeT), // _M_manager, offset 16, size 8, align 8
  ],
} as const;
declare const _Function_base: unique symbol;
export type _Function_basePointer = NonNullable<Deno.PointerValue> & {
  [_Function_base]: unknown;
};

declare const functionTemplate: unique symbol;
declare const function__Signature: unique symbol;
export type functionPointer<Signature extends Deno.UnsafeCallbackDefinition> =
  & _Function_basePointer
  & { [functionTemplate]: unknown; [function__Signature]: Signature };
export const functionT = <
  const Signature extends Deno.UnsafeCallbackDefinition,
>(
  signature: Signature,
) => {
  const { parameters: argTypes, result: res } = signature;
  return {
    struct: [
      _Function_baseT, // base class, size 24, align 8
      func({
        parameters: [ptr(_Any_dataT), ...argTypes.map(ptr)],
        result: res,
      }), // _M_invoker
    ],
  } as const;
};
