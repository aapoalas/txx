import {
  constantCase,
  pascalCase,
} from "https://deno.land/x/case@2.1.1/mod.ts";
import {
  CXChildVisitResult,
  CXCursorKind,
} from "https://deno.land/x/libclang@1.0.0-beta.8/include/typeDefinitions.ts";
import {
  CXCursor,
  CXType,
} from "https://deno.land/x/libclang@1.0.0-beta.8/mod.ts";
import { SEP } from "../Context.ts";
import {
  ClassEntry,
  ClassMethod,
  Parameter,
  PointerTypeEntry,
  RenderData,
  TypeEntry,
} from "../types.d.ts";
import {
  classesFile,
  createDummyRenderDataEntry,
  createRenderDataEntry,
  FFI,
  getCursorFileLocation,
  isPointer,
  isPointerToStructLike,
  isReturnedInRegisters,
  isStructLike,
  SYSTEM_TYPES,
  typesFile,
} from "../utils.ts";
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
  const bufClassT = `buf(${ClassT})`;
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

  for (const base of entry.bases) {
    const BaseT = `${base.name}T`;
    const BasePointer = `${base.name}Pointer`;
    inheritedPointers.push(BasePointer);
    let baseType: CXType;
    if (base.kind === "inline class<T>") {
      importsInTypesFile.set(BasePointer, typesFile(base.template.file));
      importsInTypesFile.set(BaseT, typesFile(base.template.file));
      baseType = base.template.cursor.getType()!;
    } else {
      importsInTypesFile.set(BasePointer, typesFile(base.file));
      importsInTypesFile.set(BaseT, typesFile(base.file));
      baseType = base.cursor.getType()!;
    }

    const size = baseType.getSizeOf();
    const align = baseType.getAlignOf();
    fields.push(
      `${BaseT}, // base class, size ${size}, align ${align}`,
    );
  }

  entry.fields.forEach((field) => {
    const fieldType = field.cursor.getType()!;
    const size = fieldType.getSizeOf();
    const align = fieldType.getAlignOf();
    return fields.push(
      `${
        renderTypeAsFfi(dependencies, importsInTypesFile, field.type)
      }, // ${field.name}, offset ${
        field.cursor.getOffsetOfField() / 8
      }, size ${size}, align ${align}`,
    );
  });

  for (const base of entry.virtualBases) {
    const BaseT = `${base.name}T`;
    const BasePointer = `${base.name}Pointer`;
    inheritedPointers.push(BasePointer);
    importsInTypesFile.set(BasePointer, typesFile(base.file));
    importsInTypesFile.set(BaseT, typesFile(base.file));

    const baseType = base.cursor.getType()!;
    const size = baseType.getSizeOf();
    const align = baseType.getAlignOf();
    fields.push(
      `${BaseT}, // base class, size ${size}, align ${align}`,
    );
  }

  if (inheritedPointers.length === 0) {
    inheritedPointers.push(`NonNullable<Deno.PointerValue>`);
  }

  inheritedPointers.push(`{ [${entry.name}]: unknown }`);

  const classTypesData = `export const ${CLASS_SIZE} = ${classSize} as const;
export const ${ClassT} = {
  struct: [
${fields.join("\n")}
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
  for (const method of entry.constructors) {
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
    Constructor = `${Constructor}${WithName}`;
    importsInClassesFile.set(`${lib__Class}__${Constructor}`, FFI);
    importsInBindingsFile.set(ClassT, typesFilePath);
    importsInBindingsFile.set("buf", SYSTEM_TYPES);
    bindings.add(`${lib__Class}__${Constructor}`);
    const bindingsFileData = `export const ${lib__Class}__${Constructor} = {
  name: "${method.manglings[1]}",
  parameters: [${
      [bufClassT].concat(method.parameters.map((param) =>
        renderTypeAsFfi(dependencies, importsInBindingsFile, param.type)
      ))
        .join(", ")
    }],
  result: "void",
} as const;
`;
    entriesInBindingsFile.push(createRenderDataEntry([], [], bindingsFileData));
    bufferEntryItems.push(
      `  static ${Constructor}(${
        method.parameters.map((param) =>
          `${param.name}: ${
            renderTypeAsTS(dependencies, importsInClassesFile, param.type)
          }`
        ).concat(`self = new ${ClassBuffer}()`)
          .join(", ")
      }): ${ClassBuffer} {
    ${lib__Class}__${Constructor}(${
        ["self"].concat(method.parameters.map((param) => param.name))
          .join(", ")
      });
    return self;
  }
`,
    );
  }
  if (entry.destructor) {
    importsInClassesFile.set(`${lib__Class}__Destructor`, FFI);
    importsInBindingsFile.set(ClassT, typesFilePath);
    importsInBindingsFile.set("buf", SYSTEM_TYPES);
    bindings.add(`${lib__Class}__Destructor`);
    const completeDestructorString = `export const ${lib__Class}__Destructor = {
  name: "${entry.destructor.manglings[1]}",
  parameters: [${bufClassT}],
  result: "void",
} as const;
`;
    entriesInBindingsFile.push(
      createDummyRenderDataEntry(completeDestructorString),
    );
    bufferEntryItems.push(
      `  delete(): void {
    ${lib__Class}__Destructor(this);
  }
`,
    );
    if (entry.destructor.manglings.length > 2) {
      bindings.add(`${lib__Class}__Delete`);
      importsInClassesFile.set(`${lib__Class}__Delete`, FFI);
      importsInBindingsFile.set("ptr", SYSTEM_TYPES);
      const deletingDestructorString = `export const ${lib__Class}__Delete = {
    name: "${entry.destructor.manglings[2]}",
    parameters: [ptr(${ClassT})],
    result: "void",
} as const;
`;
      entriesInBindingsFile.push(
        createDummyRenderDataEntry(deletingDestructorString),
      );
      bufferEntryItems.push(`  static delete(self: Deno.PointerValue): void {
    ${lib__Class}__Delete(self);
  }
`);
    }
  }
  for (const method of entry.methods) {
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
      continue;
    }
    const methodName = overloads.length > 0
      ? createMethodOverloadName(method, overloads)
      : method.name;
    importsInClassesFile.set(`${lib__Class}__${methodName}`, FFI);
    if (!method.cursor.isStatic()) {
      importsInBindingsFile.set(ClassT, typesFilePath);
    }
    if (
      method.result === null || typeof method.result === "string" ||
      isReturnedInRegisters(method.result)
    ) {
      const returnsStruct = isStructLike(method.result);
      const returnTsType = renderTypeAsTS(
        dependencies,
        importsInClassesFile,
        method.result,
        {
          typeOnly: !returnsStruct,
          intoJS: true,
        },
      );
      const callString = `${lib__Class}__${methodName}(${
        (method.cursor.isStatic() ? [] : ["this"]).concat(
          method.parameters.map((param) => param.name),
        ).join(", ")
      })`;
      const maybeNullishString = isPointer(method.result) ? "null | " : "";
      const typeAssertString = isPointerToStructLike(method.result)
        ? ` as ${maybeNullishString}${returnTsType}`
        : "";
      const returnString = returnsStruct
        ? `return new ${returnTsType}(${callString}.buffer);`
        : `return ${callString}`;
      bindings.add(`${lib__Class}__${methodName}`);
      const methodBindingData = `export const ${lib__Class}__${methodName} = {
    name: "${method.mangling}",
    parameters: [${
        (method.cursor.isStatic() ? [] : [bufClassT]).concat(
          method.parameters.map((x) =>
            renderTypeAsFfi(dependencies, importsInBindingsFile, x.type)
          ),
        ).join(", ")
      }],
    result: ${
        renderTypeAsFfi(dependencies, importsInBindingsFile, method.result)
      },
} as const;
`;
      entriesInBindingsFile.push(createDummyRenderDataEntry(methodBindingData));
      bufferEntryItems.push(
        `  ${method.cursor.isStatic() ? "static " : ""}${
          method.cursor.getOverriddenCursors().length > 0 ? "override " : ""
        }${renameForbiddenMethods(methodName, method)}(${
          method.parameters.map((param) =>
            `${param.name}: ${
              renderTypeAsTS(dependencies, importsInClassesFile, param.type)
            }`
          )
            .join(", ")
        }): ${maybeNullishString}${returnTsType} {
        ${returnString}${typeAssertString}
    }
`,
      );
    } else {
      // Non-POD return type: SysV ABI has a special sauce for these.
      // TODO: There might be false positives here? POD is a bit more strict than SysV ABI.
      importsInBindingsFile.set("buf", SYSTEM_TYPES);
      const resultType = `buf(${
        renderTypeAsFfi(dependencies, importsInBindingsFile, method.result)
      })`;
      const resultJsType = renderTypeAsTS(
        dependencies,
        importsInClassesFile,
        method.result,
        { typeOnly: false, intoJS: true },
      );
      bindings.add(`${lib__Class}__${methodName}`);
      const methodBindingData = `export const ${lib__Class}__${methodName} = {
    name: "${method.mangling}",
    parameters: [${
        (method.cursor.isStatic() ? [resultType] : [resultType, ClassT]).concat(
          method.parameters.map((x) =>
            renderTypeAsFfi(dependencies, importsInBindingsFile, x.type)
          ),
        ).join(", ")
      }],
    result: "pointer",
} as const;
`;
      entriesInBindingsFile.push(createDummyRenderDataEntry(methodBindingData));
      bufferEntryItems.push(
        `  ${method.cursor.isStatic() ? "static " : ""}${
          method.cursor.getOverriddenCursors().length > 0 ? "override " : ""
        }${renameForbiddenMethods(methodName, method)}(${
          method.parameters.map((param) =>
            `${param.name}: ${
              renderTypeAsTS(dependencies, importsInClassesFile, param.type)
            }`
          ).concat(`result = new ${resultJsType}()`)
            .join(", ")
        }): ${resultJsType} {
          ${lib__Class}__${methodName}(${
          (method.cursor.isStatic() ? ["result"] : ["result", "this"]).concat(
            method.parameters.map((param) => param.name),
          ).join(", ")
        });
          return result;
        }
      `,
      );
    }
  }
  const BaseClass = entry.bases.length
    ? `${entry.bases[0].name}Buffer`
    : "Uint8Array";
  if (
    entry.bases.length
  ) {
    importsInClassesFile.set(
      BaseClass,
      classesFile(entry.bases[0].file),
    );
  }
  if (entry.bases.length > 1) {
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
      super(${CLASS_SIZE})
    } else if (typeof arg === "number") {
      if (!Number.isFinite(arg) || arg < ${CLASS_SIZE}) {
        throw new Error(
          "Invalid construction of ${ClassBuffer}: Size is not finite or is too small",
        );
      }
      super(arg);
    } else {
      if (arg.byteLength < ${CLASS_SIZE}) {
        throw new Error(
          "Invalid construction of ${ClassBuffer}: Buffer size is too small",
        );
      }
      super(arg);
    }
  }

${bufferEntryItems.join("\n")}}
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
    return a.name === b.name && a.nsName === b.nsName;
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
