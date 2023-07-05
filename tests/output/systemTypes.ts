export const union3 = <const T, const U, const V>(
  a: T,
  _b: U,
  _c: V,
): T | U | V => a;

export const union2 = <const T, const U>(a: T, _b: U): T | U => a;

export const ptr = (_: unknown) => "pointer" as const;

export const isFunction = (
  type: unknown,
): type is Deno.UnsafeCallbackDefinition =>
  type !== null && typeof type === "object" && "parameters" in type &&
  Array.isArray(type.parameters) && "result" in type;

export const func = (_?: unknown) => "function" as const;

export const buf = (_: unknown) => "buffer" as const;

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

export const functionT = <const Signature>(
  _Signature: Signature,
) => {
  if (isFunction(_Signature)) {
    const { parameters: _ArgTypes, result: _Res } = _Signature;
    return {
      struct: [
        _Function_baseT, // base class, size 24, align 8
        func({
          parameters: [ptr(_Any_dataT), ..._ArgTypes.map(ptr)],
          result: _Res,
        }), // _M_invoker
      ],
    } as const;
  } else {
    throw new Error(
      "Failed to build template class: No specialization matched",
    );
  }
};
