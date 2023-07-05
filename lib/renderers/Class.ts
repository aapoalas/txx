import {
  constantCase,
  pascalCase,
} from "https://deno.land/x/case@2.1.1/mod.ts";
import {
  CXChildVisitResult,
  CXCursorKind,
} from "https://deno.land/x/libclang@1.0.0-beta.8/include/typeDefinitions.ts";
import { CXCursor } from "https://deno.land/x/libclang@1.0.0-beta.8/mod.ts";
import { SEP } from "../Context.ts";
import {
  AbsoluteSystemTypesFilePath,
  AbsoluteTypesFilePath,
  BaseClassEntry,
  ClassConstructor,
  ClassDestructor,
  ClassEntry,
  ClassField,
  ClassMethod,
  EnumEntry,
  ImportMap,
  Parameter,
  PointerTypeEntry,
  RenderData,
  RenderDataEntry,
  TypedefEntry,
  TypeEntry,
} from "../types.d.ts";
import {
  classesFile,
  createDummyRenderDataEntry,
  createRenderDataEntry,
  FFI,
  isInlineTemplateStruct,
  isPassableByValue,
  isPointerToStructLike,
  isStruct,
  isStructLike,
  isStructOrTypedefStruct,
  SYSTEM_TYPES,
  typesFile,
} from "../utils.ts";
import {
  renderFunctionExport,
  renderFunctionParameter,
  renderFunctionReturnType,
} from "./Function.ts";
import { renderTypeAsFfi, renderTypeAsTS } from "./Type.ts";

export const renderClass = ({
  bindings,
  entriesInBindingsFile,
  entriesInClassesFile,
  entriesInTypesFile,
  importsInBindingsFile,
  importsInClassesFile,
  importsInTypesFile,
  typesFilePath,
}: RenderData, entry: ClassEntry) => {
  const ClassPointer = `${entry.name}Pointer`;
  const ClassBuffer = `${entry.name}Buffer`;
  const ClassT = `${entry.name}T`;
  const lib__Class = entry.nsName.replaceAll(SEP, "__");
  const CLASS_SIZE = `${constantCase(entry.name)}_SIZE`;
  const dependencies = new Set<string>();
  importsInClassesFile.set(CLASS_SIZE, typesFilePath);

  const classType = entry.cursor.getType()!;
  const classSize = classType.getSizeOf();
  const fields: string[] = [];

  // C++ needs to setup its own vtable if it has a virtual method
  // and
  const hasOwnVtable = classHasVirtualMethod(entry.cursor) &&
    entry.bases.length === 0 &&
    (entry.virtualBases.length === 0 ||
      entry.fields.length === 0 &&
        classHasVirtualMethod(entry.virtualBases[0].cursor));
  if (hasOwnVtable) {
    fields.push(`"pointer", // vtable`);
  }

  const inheritedPointers: string[] = [];
  const fieldRenderOptions = {
    dependencies,
    inheritedPointers,
    importsInTypesFile,
  };

  for (const base of entry.bases) {
    renderClassBaseField(fieldRenderOptions, fields, base);
  }

  for (const field of entry.fields) {
    renderClassField(fieldRenderOptions, fields, field);
  }

  for (const base of entry.virtualBases) {
    renderClassBaseField(fieldRenderOptions, fields, base);
  }

  if (inheritedPointers.length === 0) {
    inheritedPointers.push(`NonNullable<Deno.PointerValue>`);
  }

  inheritedPointers.push(`{ [${entry.name}]: unknown }`);

  const classTypesData = `export const ${CLASS_SIZE} = ${classSize} as const;
export const ${ClassT} = {
  struct: [
    ${fields.join("\n    ")}
  ]
} as const;
declare const ${entry.name}: unique symbol;
export type ${ClassPointer} = ${inheritedPointers.join(" & ")};
`;
  entriesInTypesFile.push(
    createRenderDataEntry(
      [ClassT, entry.name, ClassPointer],
      [...dependencies],
      classTypesData,
    ),
  );
  dependencies.clear();
  const bufferEntryItems: string[] = [];
  const methodRenderOptions: MethodRenderOptions = {
    bindings,
    bufferEntryItems,
    ClassBuffer,
    ClassPointer,
    ClassT,
    dependencies,
    entriesInBindingsFile,
    entry,
    importsInBindingsFile,
    importsInClassesFile,
    lib__Class,
    typesFilePath,
  };
  for (const method of entry.constructors) {
    renderClassConstructor(methodRenderOptions, method);
  }
  if (entry.destructor) {
    renderClassDestructors(methodRenderOptions, entry.destructor);
  }
  for (const method of entry.methods) {
    renderClassMethod(methodRenderOptions, method);
  }
  let BaseClass = "Uint8Array";
  if (entry.bases.length > 0) {
    BaseClass = `${entry.bases[0].name}Buffer`;
    importsInClassesFile.set(
      BaseClass,
      classesFile(entry.bases[0].file),
    );
  } else if (entry.fields.length === 0 && entry.virtualBases.length > 0) {
    BaseClass = `${entry.virtualBases[0].name}Buffer`;
    importsInClassesFile.set(
      BaseClass,
      classesFile(entry.bases[0].file),
    );
  }
  if ((entry.bases.length + entry.virtualBases.length) > 1) {
    console.warn(
      "Multi-inheritance detected,",
      entry.name,
      "inherits from",
      entry.bases.map((x) => x.name).join(" and "),
    );
  }
  const classDefinition = `export class ${ClassBuffer} extends ${BaseClass} {
  constructor(arg?: ArrayBufferLike | number) {
    if (typeof arg === "undefined") {
      super(${CLASS_SIZE});
      return;
    } else if (typeof arg === "number") {
      if (!Number.isFinite(arg) || arg < ${CLASS_SIZE}) {
        throw new Error(
          "Invalid construction of ${ClassBuffer}: Size is not finite or is too small",
        );
      }
      super(arg);
      return;
    }
    if (arg.byteLength < ${CLASS_SIZE}) {
      throw new Error(
        "Invalid construction of ${ClassBuffer}: Buffer size is too small",
      );
    }
    super(arg);
  }

  ${bufferEntryItems.join("\n  ")}
}
`;
  entriesInClassesFile.push(
    createRenderDataEntry([ClassBuffer], [BaseClass], classDefinition),
  );
};

const createMethodOverloadName = (
  method: ClassMethod,
  overloads: ClassMethod[],
): string => {
  if (
    method.cursor.isStatic() &&
    !overloads.every((otherMethod) => otherMethod.cursor.isStatic()) &&
    method.parameters.length > 0
  ) {
    return `static${pascalCase(method.name)}${
      createParameterOverloadName(
        method.parameters[0],
        method.parameters[0].type,
      )
    }${
      method.parameters.length > 1
        ? `With${
          method.parameters.slice(1).map((param) =>
            createParameterOverloadName(param, param.type)
          )
            .join("And")
        }`
        : ""
    }`;
  } else if (
    method.cursor.isConst() &&
    overloads.some((otherMethod) =>
      !otherMethod.cursor.isStatic() && !otherMethod.cursor.isConst() &&
      methodTypesAreEqual(method, otherMethod)
    )
  ) {
    return `${method.name}AsConst`;
  } else if (
    overloads.length === 1 &&
    method.parameters.length > overloads[0].parameters.length
  ) {
    return `${method.name}With${
      method.parameters.slice(overloads[0].parameters.length).map(
        (param) => createParameterOverloadName(param, param.type),
      ).join("And")
    }`;
  } else if (
    overloads.length === 1 &&
    method.parameters.length > 0 &&
    method.parameters.length === overloads[0].parameters.length
  ) {
    const otherMethod = overloads[0];
    const parameterDifferences = method.parameters.map((param, index) =>
      typesAreEqual(param.type, otherMethod.parameters[index].type)
        ? null
        : param
    );
    const paramDifferenceNames = parameterDifferences.map(
      (diff, index) => {
        if (diff === null) {
          return null;
        }
        const left = method.parameters[index];
        const right = otherMethod.parameters[index];
        if (left.name === right.name) {
          return createParameterOverloadName(left);
        }
        return pascalCase(left.name);
      },
    ).filter(Boolean);
    return `${method.name}With${paramDifferenceNames.join("And")}`;
  } else if (overloads.length === 1) {
    // Noop
    return method.name;
  }
  // Multiple overloads
  const overloadSizes = new Set([
    method.parameters.length,
    ...overloads.map((overload) => overload.parameters.length),
  ]);
  if (overloadSizes.size === overloads.length + 1) {
    // All overloads are of different sizes
    if (
      overloads.some((overload) =>
        overload.parameters.length < method.parameters.length
      )
    ) {
      const addedDifferentParams = method.parameters.map((param, index) =>
        overloads.some((overload) =>
            index < overload.parameters.length &&
            typesAreEqual(param.type, overload.parameters[index].type)
          )
          ? null
          : param
      );
      const addedParamNames = addedDifferentParams.map(
        (diff, index) => {
          if (diff === null) {
            return null;
          }
          const left = method.parameters[index];
          if (
            overloads.some((overload) =>
              index < overload.parameters.length &&
              overload.parameters[index].name === left.name
            )
          ) {
            return createParameterOverloadName(left);
          }
          return pascalCase(left.name);
        },
      ).filter(Boolean);
      return `${method.name}With${addedParamNames.join("And")}`;
    }
    return method.name;
  }
  const sameSizeOverloads = overloads.filter((overload) =>
    overload.parameters.length === method.parameters.length
  );
  const redundantPartsAreImportant =
    sameSizeOverloads.length !== overloads.length;
  const parameterVariances = method.parameters.map((param, index) =>
    sameSizeOverloads.filter((overload) =>
      !typesAreEqual(param.type, overload.parameters[index].type)
    ).length
  );
  const parameterDifferences = method.parameters.map((param, index) =>
    // If every same size overload has the same type in the same index, then it's redundant
    parameterVariances[index] <= 1 ||
      sameSizeOverloads.every((overload) =>
        typesAreEqual(param.type, overload.parameters[index].type)
      )
      ? null
      // in which case this is the interesting part
      : param
  );
  const paramDifferenceNames = parameterDifferences.map(
    (diff, index) => {
      if (diff === null) {
        // Redundant parts can be named, it doesn't matter that this will probably be repeated.
        if (!redundantPartsAreImportant) {
          return null;
        }
        const paramName = pascalCase(method.parameters[index].name);
        const paramTypeName = createParameterOverloadName(
          method.parameters[index],
        );
        return paramTypeName.length < paramName.length
          ? paramTypeName
          : paramName;
      } else if (
        sameSizeOverloads.every((overload) =>
          overload.parameters[index].name !== diff.name
        )
      ) {
        // No other overload gives the same param name, we can use that.
        return pascalCase(diff.name);
      }
      // Create a type-based name.
      return createParameterOverloadName(diff);
    },
  ).filter(Boolean);
  return `${method.name}With${paramDifferenceNames.join("And")}`;
};

const methodTypesAreEqual = (a: ClassMethod, b: ClassMethod): boolean =>
  typesAreEqual(a.result, b.result) &&
  a.parameters.length === b.parameters.length &&
  a.parameters.every((param, index) =>
    typesAreEqual(param.type, b.parameters[index].type)
  );

const typesAreEqual = (a: null | TypeEntry, b: null | TypeEntry): boolean => {
  if (a === b) {
    return true;
  } else if (
    a === null || b === null || typeof a === "string" || typeof b === "string"
  ) {
    return false;
  }
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === "typedef" || a.kind === "enum") {
    return a.name === b.name &&
      a.nsName === (b as TypedefEntry | EnumEntry).nsName;
  } else if (a.kind === "class") {
    const other = b as ClassEntry;
    return a.fields.length === other.fields.length &&
      a.fields.every((p, i) => typesAreEqual(p.type, other.fields[i].type));
  } else if (a.kind === "pointer") {
    if (a.pointee === "self" || (b as PointerTypeEntry).pointee === "self") {
      throw new Error(
        "Method parameter replaced with self reference, this should not happen",
      );
    }
    return typesAreEqual(
      a.pointee,
      (b as PointerTypeEntry).pointee as TypeEntry,
    );
  }
  return false;
};

const createParameterOverloadName = (
  param: Parameter,
  type: TypeEntry = param.type,
): string => {
  if (typeof type === "string") {
    return pascalCase(type);
  } else if (type.kind === "pointer") {
    if (type.pointee === "self") {
      throw new Error(
        "Method parameter replaced with self reference, this should not happen",
      );
    }
    return createParameterOverloadName(param, type.pointee);
  } else if (type.kind === "enum") {
    return pascalCase(
      type.name,
    );
  } else if (type.kind === "function" || type.kind === "fn") {
    return pascalCase(param.name);
  } else if (type.kind === "class") {
    return pascalCase(param.name);
  } else if (type.kind === "typedef") {
    return pascalCase(type.name);
  } else if (type.kind === "inline class<T>") {
    return `Inline${pascalCase(type.template.name)}`;
  } else if (type.kind === "inline class" || type.kind === "[N]") {
    return `Inline${pascalCase(param.name)}`;
  }
  throw new Error("Unreachable");
};

const FORBIDDEN_NAMES = [
  "at",
  "fill",
  "find",
  "findLast",
  "length",
  "toString",
] as const;

const renameForbiddenMethods = (
  methodName: string,
  method: ClassMethod,
): string => {
  const isForbidden = FORBIDDEN_NAMES.some((name) => methodName === name);
  if (!isForbidden) {
    return methodName;
  } else if (methodName !== method.name) {
    throw new Error(
      `Overload name creation created a forbidden method name '${methodName}' from '${method.name}'`,
    );
  }

  if (method.parameters.length > 0) {
    return `${methodName}${pascalCase(method.parameters[0].name)}`;
  }
  return `${methodName}Fn`;
};

const classHasVirtualMethod = (cursor: CXCursor): boolean => {
  if (
    cursor.kind !== CXCursorKind.CXCursor_ClassDecl &&
    cursor.kind !== CXCursorKind.CXCursor_StructDecl
  ) {
    throw new Error(
      "Invalid call to classHasVtable: Cursor does not point to ClassDecl",
    );
  }
  return cursor.visitChildren((c) =>
    (c.kind === CXCursorKind.CXCursor_CXXMethod ||
        c.kind === CXCursorKind.CXCursor_Destructor) && c.isVirtual()
      ? CXChildVisitResult.CXChildVisit_Break
      : CXChildVisitResult.CXChildVisit_Continue
  );
};

interface FieldRenderOptions {
  dependencies: Set<string>;
  importsInTypesFile: ImportMap;
  inheritedPointers: string[];
  replaceMap?: Map<string, string>;
}

export const renderClassBaseField = (
  { dependencies, importsInTypesFile, inheritedPointers }: FieldRenderOptions,
  fields: string[],
  base: BaseClassEntry,
) => {
  const BaseT = renderTypeAsFfi(dependencies, importsInTypesFile, base);
  let baseTypeSource: AbsoluteTypesFilePath;
  if (base.kind === "inline class<T>") {
    if (
      base.specialization?.bases.length === 0 &&
      base.specialization.fields.length === 0 &&
      base.specialization.virtualBases.length === 0
    ) {
      return;
    }
    baseTypeSource = typesFile(base.template.file);
  } else {
    if (
      base.kind === "class" && base.bases.length === 0 &&
      base.fields.length === 0 && base.virtualBases.length === 0
    ) {
      return;
    }
    baseTypeSource = typesFile(base.file);
  }
  const baseType = base.cursor.getType();
  if (
    fields.length === 0 && (isStruct(base) || isStructOrTypedefStruct(base))
  ) {
    // Pointer to class with inheritance is only usable
    // as the base class if the base class is concrete and
    // is the very first field in the inheriting class
    // and thus holds the vtable pointer.
    const BasePointer = `${base.name}Pointer`;
    inheritedPointers.push(BasePointer);
    importsInTypesFile.set(BasePointer, baseTypeSource);
  }
  importsInTypesFile.set(BaseT, baseTypeSource);

  const size = baseType?.getSizeOf();
  const align = baseType?.getAlignOf();
  if (size && align) {
    fields.push(`${BaseT}, // base class, size ${size}, align ${align}`);
  } else {
    fields.push(`${BaseT}, // base class`);
  }
};

export const renderClassField = (
  {
    dependencies,
    importsInTypesFile,
    replaceMap,
  }: FieldRenderOptions,
  fields: string[],
  field: ClassField,
) => {
  const fieldType = field.cursor.getType()!;
  const size = fieldType.getSizeOf();
  const align = fieldType.getAlignOf();
  const sizeString = size >= 0 ? `, size ${size}` : "";
  const alignString = align >= 0 ? `, align ${align}` : "";
  const rawOffset = field.cursor.getOffsetOfField();
  const offsetString = rawOffset >= 0 ? `, offset ${rawOffset / 8}` : "";
  fields.push(
    `${
      renderTypeAsFfi(
        dependencies,
        importsInTypesFile,
        field.type,
        replaceMap,
      )
    }, // ${field.name}${offsetString}${sizeString}${alignString}`,
  );
};

interface MethodRenderOptions {
  bindings: Set<string>;
  bufferEntryItems: string[];
  ClassBuffer: string;
  ClassPointer: string;
  ClassT: string;
  dependencies: Set<string>;
  entriesInBindingsFile: RenderDataEntry[];
  entry: ClassEntry;
  importsInBindingsFile: ImportMap;
  importsInClassesFile: ImportMap;
  lib__Class: string;
  typesFilePath: AbsoluteTypesFilePath | AbsoluteSystemTypesFilePath;
}

const renderClassConstructor = (
  {
    bindings,
    bufferEntryItems,
    ClassBuffer,
    ClassT,
    dependencies,
    entriesInBindingsFile,
    entry,
    importsInBindingsFile,
    importsInClassesFile,
    lib__Class,
    typesFilePath,
  }: MethodRenderOptions,
  method: ClassConstructor,
) => {
  method.cursor.isCopyConstructor;
  const firstParam = method.parameters[0];
  let Constructor = "Constructor";
  let WithName = "";
  if (
    method.cursor.isCopyConstructor() ||
    method.cursor.isMoveConstructor()
  ) {
    if (method.cursor.isCopyConstructor()) {
      Constructor = "CopyConstructor";
    } else {
      Constructor = "MoveConstructor";
    }
    if (
      typeof firstParam.type !== "object" ||
      firstParam.type.kind !== "pointer"
    ) {
      throw new Error(
        "Copy/Move constructor did not have pointer as first parameter",
      );
    }
    if (firstParam.type.pointee !== entry) {
      // Referring to inherited type
      WithName = `With${
        pascalCase((firstParam.type.pointee as ClassEntry).name)
      }`;
    }
    if (method.parameters.length > 1) {
      const extraParameterNames = method.parameters.slice(1).map((x) =>
        createParameterOverloadName(x)
      ).join("And");
      WithName = WithName
        ? `${WithName}And${extraParameterNames}`
        : `With${extraParameterNames}`;
    }
  } else if (method.parameters.length) {
    WithName = `With${
      method.parameters.map((x) => createParameterOverloadName(x)).join("And")
    }`;
  }
  const parameterStrings: string[] = [`buf(${ClassT})`];
  const parameterNames: string[] = ["self"];
  const parameterRenderData: ClassParameterRenderData[] = [];
  for (const param of method.parameters) {
    parameterNames.push(param.name);
    parameterStrings.push(
      renderFunctionParameter(dependencies, importsInBindingsFile, param),
    );
    parameterRenderData.push({
      name: param.name,
      type: renderTypeAsTS(dependencies, importsInClassesFile, param.type),
    });
  }
  parameterRenderData.push({
    name: "self",
    defaultValue: `new ${ClassBuffer}()`,
  });
  Constructor = `${Constructor}${WithName}`;
  importsInClassesFile.set(`${lib__Class}__${Constructor}`, FFI);
  importsInBindingsFile.set(ClassT, typesFilePath);
  importsInBindingsFile.set("buf", SYSTEM_TYPES);
  bindings.add(`${lib__Class}__${Constructor}`);
  const bindingsFileData = renderFunctionExport(
    `${lib__Class}__${Constructor}`,
    method.manglings[1],
    parameterStrings,
    `"void"`,
  );
  entriesInBindingsFile.push(createRenderDataEntry([], [], bindingsFileData));
  bufferEntryItems.push(
    renderClassMethodBinding(
      Constructor,
      parameterRenderData,
      ClassBuffer,
      [
        `${lib__Class}__${Constructor}(${parameterNames.join(", ")});`,
        "return self;",
      ],
      {
        overridden: false,
        static: true,
      },
    ),
  );
};

const renderClassDestructors = (
  {
    bindings,
    bufferEntryItems,
    ClassPointer,
    ClassT,
    entriesInBindingsFile,
    importsInBindingsFile,
    importsInClassesFile,
    lib__Class,
    typesFilePath,
  }: MethodRenderOptions,
  destructor: ClassDestructor,
) => {
  importsInClassesFile.set(`${lib__Class}__Destructor`, FFI);
  importsInBindingsFile.set(ClassT, typesFilePath);
  importsInBindingsFile.set("buf", SYSTEM_TYPES);
  bindings.add(`${lib__Class}__Destructor`);
  const completeDestructorString = renderFunctionExport(
    `${lib__Class}__Destructor`,
    destructor.manglings[1],
    [`buf(${ClassT})`],
    `"void"`,
  );
  entriesInBindingsFile.push(
    createDummyRenderDataEntry(completeDestructorString),
  );
  bufferEntryItems.push(
    renderClassMethodBinding(
      "delete",
      [],
      "void",
      [`${lib__Class}__Destructor(this);`],
      { static: false, overridden: false },
    ),
  );

  if (destructor.manglings.length > 2) {
    bindings.add(`${lib__Class}__Delete`);
    importsInClassesFile.set(`${lib__Class}__Delete`, FFI);
    importsInBindingsFile.set("ptr", SYSTEM_TYPES);
    const deletingDestructorString = renderFunctionExport(
      `${lib__Class}__Delete`,
      destructor.manglings[2],
      [`ptr(${ClassT})`],
      `"void"`,
    );
    entriesInBindingsFile.push(
      createDummyRenderDataEntry(deletingDestructorString),
    );
    importsInClassesFile.set(ClassPointer, typesFilePath);
    bufferEntryItems.push(
      renderClassMethodBinding(
        "delete",
        [{ name: "self", type: ClassPointer }],
        "void",
        [`${lib__Class}__Delete(self);`],
        {
          static: true,
          overridden: false,
        },
      ),
    );
  }
};

const renderClassMethod = (
  {
    bindings,
    bufferEntryItems,
    ClassT,
    dependencies,
    entriesInBindingsFile,
    entry,
    importsInBindingsFile,
    importsInClassesFile,
    lib__Class,
    typesFilePath,
  }: MethodRenderOptions,
  method: ClassMethod,
) => {
  const overloads = entry.methods.filter((otherMethod) =>
    otherMethod !== method &&
    otherMethod.name === method.name
  );

  if (
    method.cursor.isConst() &&
    overloads.some((otherMethod) =>
      !otherMethod.cursor.isStatic() && !otherMethod.cursor.isConst() &&
      methodTypesAreEqual(method, otherMethod)
    )
  ) {
    // Do not generate const versions of otherwise identical methods.
    return;
  }
  const methodName = overloads.length > 0
    ? createMethodOverloadName(method, overloads)
    : method.name;
  importsInClassesFile.set(`${lib__Class}__${methodName}`, FFI);
  const isStaticMethod = method.cursor.isStatic();
  const returnByValue = isPassableByValue(method.result);
  if (!isStaticMethod) {
    importsInBindingsFile.set(ClassT, typesFilePath);
  }
  bindings.add(`${lib__Class}__${methodName}`);
  const parameterNames = method.parameters.map((param) => param.name);
  const parameterStrings = method.parameters.map((param) =>
    renderFunctionParameter(dependencies, importsInBindingsFile, param)
  );
  const parameterTsTypes = method.parameters.map((
    param,
  ): ClassParameterRenderData => ({
    name: param.name,
    type: renderTypeAsTS(dependencies, importsInClassesFile, param.type),
  }));
  if (!isStaticMethod) {
    // Instance methods pass this parameter.
    parameterNames.unshift("this");
    importsInBindingsFile.set("buf", SYSTEM_TYPES);
    parameterStrings.unshift(`buf(${ClassT})`);
  }
  const resultTsType = renderTypeAsTS(
    dependencies,
    importsInClassesFile,
    method.result,
    {
      intoJS: true,
    },
  );
  const resultType = renderFunctionReturnType(
    dependencies,
    importsInBindingsFile,
    method.result,
    parameterStrings,
  );
  if (!returnByValue) {
    // Result returned by 0th buffer parameter, named "result".
    parameterNames.unshift("result");
    if (
      method.result && typeof method.result === "object" &&
      "file" in method.result
    ) {
      importsInClassesFile.set(resultTsType, classesFile(method.result.file));
    }
    parameterTsTypes.push({
      name: "result",
      defaultValue: `new ${resultTsType}()`,
    });
  }
  const tsCallString = `${lib__Class}__${methodName}(${
    parameterNames.join(", ")
  })`;
  const bodyLines: string[] = [];
  if (returnByValue) {
    // Return by value calls can call function and return directly.
    if (isPointerToStructLike(method.result)) {
      // Pointers to struct-like types have their own pointer types that
      // extend `Deno.PointerObject`. We need to do our own maybe-null typing.
      bodyLines.push(`return ${tsCallString} as null | ${resultTsType};`);
    } else if (isStructLike(method.result)) {
      // Struct-like types return Uint8Array. We want to take the buffer and
      // change into the proper custom ClassBuffer type.
      bodyLines.push(`return new ${resultTsType}(${tsCallString}.buffer);`);
    } else {
      // All other types are good as-it-is.
      bodyLines.push(`return ${tsCallString};`);
    }
  } else {
    // Return by ref calls call the function first with "result"
    // as 0th parameter, then return the result.
    bodyLines.push(`${tsCallString};`, "return result;");
  }
  const methodBindingString = renderFunctionExport(
    `${lib__Class}__${methodName}`,
    method.mangling,
    parameterStrings,
    resultType,
  );
  entriesInBindingsFile.push(createDummyRenderDataEntry(methodBindingString));
  const classMethodString = renderClassMethodBinding(
    renameForbiddenMethods(methodName, method),
    parameterTsTypes,
    returnByValue && isPointerToStructLike(method.result)
      ? `null | ${resultTsType}`
      : resultTsType,
    bodyLines,
    {
      overridden: method.cursor.getOverriddenCursors().length > 0,
      static: isStaticMethod,
    },
  );
  bufferEntryItems.push(classMethodString);

  let count = 0;
  const asd: string[] = [];
  for (const param of method.parameters) {
    if (
      isStruct(param.type) && !isPassableByValue(param.type) &&
      param.type.usedAsBuffer && param.type.usedAsPointer
    ) {
      asd.push(param.type.name);
      count++;
    } else if (
      isInlineTemplateStruct(param.type) && !isPassableByValue(param.type)
    ) {
      if (!param.type.specialization) {
        param.type.specialization = param.type.template.defaultSpecialization!;
      }
      if (
        param.type.specialization.usedAsBuffer &&
        param.type.specialization.usedAsPointer
      ) {
        asd.push(param.type.name!);
        count++;
      }
    }
  }
  if (count) {
    console.group(renameForbiddenMethods(methodName, method));
    for (const a of asd) {
      console.log(a);
    }
    console.groupEnd();
  }
};

interface ClassParameterRenderData {
  name: string;
  type?: string;
  defaultValue?: string;
}

const renderClassMethodBinding = (
  methodName: string,
  parameters: ClassParameterRenderData[],
  result: string,
  bodyLines: string[],
  options: {
    static: boolean;
    overridden: boolean;
  },
) => {
  return `  ${options.static ? "static " : ""}${
    options.overridden ? "override " : ""
  }${methodName}(${
    parameters.map((param) =>
      `${param.name}${param.type ? `: ${param.type}` : ""}${
        param.defaultValue ? ` = ${param.defaultValue}` : ""
      }`
    ).join(", ")
  }): ${result} {
  ${bodyLines.join("\n  ")}
}
`;
};
