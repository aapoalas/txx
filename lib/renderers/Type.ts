import pascalCase from "https://deno.land/x/case@2.1.1/pascalCase.ts";
import { ImportMap, TypedefEntry, TypeEntry } from "../types.d.ts";
import {
  classesFile,
  createSizedStruct,
  getSizeOfType,
  isFunction,
  isPointer,
  isStructLike,
  SYSTEM_TYPES,
  typesFile,
} from "../utils.ts";

const EMPTY_MAP = new Map<string, string>();

export const renderTypeAsFfi = (
  dependencies: Set<string>,
  importMap: ImportMap,
  type: null | TypeEntry,
  templateNameReplaceMap = EMPTY_MAP,
): string => {
  if (type === null) {
    return `"void"`;
  } else if (typeof type === "string") {
    switch (type) {
      case "bool":
      case "f32":
      case "f64":
      case "u8":
      case "i8":
      case "u16":
      case "i16":
      case "u32":
      case "i32":
      case "u64":
      case "i64":
      case "buffer":
      case "pointer":
        return `"${type}"`;
      case "cstring":
      case "cstringArray": {
        const nameT = `${type}T`;
        importMap.set(nameT, SYSTEM_TYPES);
        dependencies.add(nameT);
        return nameT;
      }
      default:
        throw new Error("Missing switch arm");
    }
  } else if (
    type.kind === "enum"
  ) {
    const name = type.name;
    const nameT = `${name}T`;
    importMap.set(nameT, typesFile(type.file));
    dependencies.add(nameT);
    return nameT;
  } else if (type.kind === "class") {
    const name = type.name;
    const nameT = `${name}T`;
    importMap.set(nameT, typesFile(type.file));
    dependencies.add(nameT);
    return nameT;
  } else if (type.kind === "typedef") {
    const name = type.name;
    const nameT = `${name}T`;
    importMap.set(nameT, typesFile(type.file));
    dependencies.add(nameT);
    if (
      isFunction(type.target) ||
      isPointer(type.target) && isFunction(type.target.pointee)
    ) {
      importMap.set("func", SYSTEM_TYPES);
      return `func(${nameT})`;
    }

    return nameT;
  } else if (type.kind === "pointer") {
    if (typeof type.pointee === "string") {
      importMap.set("buf", SYSTEM_TYPES);
      if (type.pointee === "self") {
        return `buf("self")`;
      }
      return `buf(${(renderTypeAsFfi(
        dependencies,
        importMap,
        type.pointee,
        templateNameReplaceMap,
      ))})`;
    }
    if (type.pointee.kind === "inline class<T>") {
      importMap.set("buf", SYSTEM_TYPES);
      return `buf(${
        renderTypeAsFfi(
          dependencies,
          importMap,
          type.pointee,
          templateNameReplaceMap,
        )
      })`;
    } else if (
      type.pointee.kind === "pointer" || type.pointee.kind === "class"
    ) {
      if (
        type.pointee.kind === "class" && !type.pointee.usedAsBuffer &&
        type.pointee.usedAsPointer
      ) {
        importMap.set("ptr", SYSTEM_TYPES);
        return `ptr(${(renderTypeAsFfi(
          dependencies,
          importMap,
          type.pointee,
          templateNameReplaceMap,
        ))})`;
      }
      importMap.set("buf", SYSTEM_TYPES);
      return `buf(${(renderTypeAsFfi(
        dependencies,
        importMap,
        type.pointee,
        templateNameReplaceMap,
      ))})`;
    } else if (type.pointee.kind === "function" || type.pointee.kind === "fn") {
      // Function pointer is just a function.
      return `func(${
        renderTypeAsFfi(
          dependencies,
          importMap,
          type.pointee,
          templateNameReplaceMap,
        )
      })`;
    } else if (type.pointee.kind === "typedef") {
      const isPODType = type.pointee.cursor.getType()!.isPODType();
      if (isPODType) {
        importMap.set("buf", SYSTEM_TYPES);
      } else {
        importMap.set("ptr", SYSTEM_TYPES);
      }
      return isPODType
        ? `buf(${(renderTypeAsFfi(
          dependencies,
          importMap,
          type.pointee,
          templateNameReplaceMap,
        ))})`
        : `ptr(${(renderTypeAsFfi(
          dependencies,
          importMap,
          type.pointee,
          templateNameReplaceMap,
        ))})`;
    } else if (type.pointee.kind === "enum") {
      importMap.set("buf", SYSTEM_TYPES);
      return `buf(${(renderTypeAsFfi(
        dependencies,
        importMap,
        type.pointee,
        templateNameReplaceMap,
      ))})`;
    } else if (
      type.pointee.kind === "inline class" || type.pointee.kind === "[N]"
    ) {
      if (type.pointee.type.isPODType()) {
        return renderTypeAsFfi(
          dependencies,
          importMap,
          "pointer",
          templateNameReplaceMap,
        );
      } else {
        return renderTypeAsFfi(
          dependencies,
          importMap,
          "buffer",
          templateNameReplaceMap,
        );
      }
    } else if (isStructLike(type.pointee)) {
      importMap.set("buf", SYSTEM_TYPES);
      return `buf(${(renderTypeAsFfi(
        dependencies,
        importMap,
        type.pointee,
        templateNameReplaceMap,
      ))})`;
    } else {
      importMap.set("ptr", SYSTEM_TYPES);
      return `ptr(${(renderTypeAsFfi(
        dependencies,
        importMap,
        type.pointee,
        templateNameReplaceMap,
      ))})`;
    }
  } else if (type.kind === "function" || type.kind === "fn") {
    const parametersStrings = type.parameters.map((param) =>
      renderTypeAsFfi(
        dependencies,
        importMap,
        param.type,
        templateNameReplaceMap,
      )
    )
      .join(", ");
    if (type.parameters.length === 1 && parametersStrings.startsWith("...")) {
      return `{ parameters: ${parametersStrings.substring(3)}, result: ${
        renderTypeAsFfi(
          dependencies,
          importMap,
          type.result,
          templateNameReplaceMap,
        )
      } }`;
    }
    return `{ parameters: [${parametersStrings}], result: ${
      renderTypeAsFfi(
        dependencies,
        importMap,
        type.result,
        templateNameReplaceMap,
      )
    } }`;
  } else if (type.kind === "inline class<T>") {
    const templateT = `${type.template.name}T`;
    importMap.set(templateT, typesFile(type.template.file));
    dependencies.add(templateT);
    return `${templateT}(${
      (type.parameters.map((param) =>
        param.kind === "parameter"
          ? renderTypeAsFfi(
            dependencies,
            importMap,
            param.type,
            templateNameReplaceMap,
          )
          : param.name
      ))
        .join(
          ", ",
        )
    })`;
  } else if (type.kind === "inline class") {
    return `{ struct: [${
      (type.base
        ? [
          renderTypeAsFfi(
            dependencies,
            importMap,
            type.base,
            templateNameReplaceMap,
          ),
        ]
        : [])
        .concat(
          type.fields.map((field) =>
            renderTypeAsFfi(
              dependencies,
              importMap,
              field.type,
              templateNameReplaceMap,
            )
          ),
        ).join(
          ", ",
        )
    }] }`;
  } else if (type.kind === "[N]") {
    const fieldString = renderTypeAsFfi(
      dependencies,
      importMap,
      type.element,
      templateNameReplaceMap,
    );
    return `{ struct: [${
      new Array(type.length).fill(fieldString).join(",")
    }] }`;
  } else if (type.kind === "inline union") {
    const uniqueSortedFields = [
      ...new Set(
        type.fields.sort((a, b) =>
          getSizeOfType(b.type) - getSizeOfType(a.type)
        ).map((field) =>
          renderTypeAsFfi(
            dependencies,
            importMap,
            field.type,
            templateNameReplaceMap,
          )
        ),
      ),
    ];
    const count = uniqueSortedFields.length;
    importMap.set(`union${count}`, SYSTEM_TYPES);
    return `union${count}(${
      uniqueSortedFields.join(
        ", ",
      )
    })`;
  } else if (type.kind === "member pointer") {
    return JSON.stringify(createSizedStruct(type.type));
  } else if (type.kind === "class<T>") {
    importMap.set(`${type.name}T`, typesFile(type.file));
    importMap.set("ptr", SYSTEM_TYPES);
    return `${type.name}T`;
  } else if (type.kind === "union") {
    const name = type.name;
    const nameT = `${name}T`;
    importMap.set(nameT, typesFile(type.file));
    dependencies.add(nameT);

    return nameT;
  } else if (type.kind === "<T>") {
    if (type.isRef) {
      importMap.set("ptr", SYSTEM_TYPES);
    }
    const TypeName = templateNameReplaceMap.get(type.name) ||
      pascalCase(type.name);
    if (type.isSpread && type.isRef) {
      return `...${TypeName}.map(ptr)`;
    } else if (type.isSpread) {
      return `...${TypeName}`;
    } else if (type.isRef) {
      return `ptr(${TypeName})`;
    }
    return TypeName;
  } else {
    throw new Error(
      // @ts-expect-error kind and name will exist in any added TypeEntry types
      "internal error: unknown type kind: " + type.kind + ": " + type.name,
    );
  }
};

export const maybeWrapWithTypeof = (result: string) =>
  result.at(0) === `"` || result.at(0) === "{" ? result : `typeof ${result}`;

export const renderTypeAsTS = (
  dependencies: Set<string>,
  importMap: ImportMap,
  type: null | TypeEntry,
  {
    typeOnly = true,
    intoJS = false,
  }: {
    typeOnly?: boolean;
    intoJS?: boolean;
  } = {},
): string => {
  if (type === null) {
    return "void";
  } else if (typeof type === "string") {
    switch (type) {
      case "bool":
        return "boolean";
      case "f32":
      case "f64":
      case "u8":
      case "i8":
      case "u16":
      case "i16":
      case "u32":
      case "i32":
        return "number";
      case "u64":
      case "i64":
        return "number | bigint";
      case "pointer":
        return "Deno.PointerValue";
      case "buffer":
      case "cstring":
      case "cstringArray":
        return "Uint8Array";
      default:
        throw new Error("Missing match arm");
    }
  }
  if (type.kind === "enum") {
    const name = type.name;
    importMap.set(`type ${name}`, typesFile(type.file));
    dependencies.add(name);
    return name;
  } else if (type.kind === "typedef") {
    const name = type.name;
    if (isStructLike(type)) {
      const nameBuffer = `${name}Buffer`;
      importMap.set(nameBuffer, classesFile(type.file));
      dependencies.add(nameBuffer);
      return nameBuffer;
    }
    importMap.set(`type ${name}`, typesFile((type as TypedefEntry).file));
    dependencies.add(name);
    return name;
  } else if (
    type.kind === "function" || type.kind === "fn"
  ) {
    if ("name" in type && type.name) {
      importMap.set(type.name, typesFile(type.file));
      dependencies.add(type.name);
      return type.name;
    }
    return "Deno.PointerValue";
  } else if (type.kind === "pointer") {
    if (type.pointee === "self") {
      return "Deno.PointerValue";
    }
    if (isStructLike(type.pointee) && type.pointee.name) {
      if (intoJS) {
        const name = `${type.pointee.name}Pointer`;
        importMap.set(`type ${name}`, typesFile(type.pointee.file));
        dependencies.add(name);
        return name;
      } else {
        const name = `${type.pointee.name}Buffer`;
        importMap.set(
          typeOnly ? `type ${name}` : name,
          classesFile(type.pointee.file),
        );
        dependencies.add(name);
        return name;
      }
    } else if (isFunction(type.pointee)) {
      return renderTypeAsTS(dependencies, importMap, type.pointee);
    }
    return "Deno.PointerValue";
  } else if (type.kind === "class") {
    // If class is only seen used as a pointer, then always expect it as a pointer.
    const name = !type.usedAsBuffer && type.usedAsPointer
      ? `${type.name}Pointer`
      : `${type.name}Buffer`;
    importMap.set(
      typeOnly || !type.usedAsBuffer && type.usedAsPointer
        ? `type ${name}`
        : name,
      classesFile(type.file),
    );
    dependencies.add(name);
    return name;
  } else if (
    type.kind === "inline class" || type.kind === "inline class<T>" ||
    type.kind === "[N]" || type.kind === "inline union"
  ) {
    return "Uint8Array";
  } else if (type.kind === "member pointer") {
    return "number";
  } else if (type.kind === "class<T>") {
    throw new Error("Unexpected class template entry");
  } else if (type.kind === "union") {
    throw new Error("Unexpected union entry");
  } else if (type.kind === "<T>") {
    throw new Error("Unexpected template parameter entry");
  } else {
    throw new Error(
      // @ts-expect-error No type kind should exist here
      `internal error: unknown type kind ${type.kind} ${type.name}`,
    );
  }
};
