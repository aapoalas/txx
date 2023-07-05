import pascalCase from "https://deno.land/x/case@2.1.1/pascalCase.ts";
import { ImportMap, TypeEntry } from "../../types.d.ts";
import {
  createSizedStruct,
  getSizeOfType,
  isFunction,
  isPassableByValue,
  isPointer,
  isStructLike,
  SYSTEM_TYPES,
  typesFile,
} from "../../utils.ts";

const EMPTY_MAP = new Map<string, string>();

export const renderTypeAsFfiBindings = (
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
    return renderPointerAsFfi(
      dependencies,
      importMap,
      type.pointee,
      templateNameReplaceMap,
    );
  } else if (type.kind === "function" || type.kind === "fn") {
    const parametersStrings = type.parameters.map((param) =>
      renderTypeAsFfiBindings(
        dependencies,
        importMap,
        param.type,
        templateNameReplaceMap,
      )
    )
      .join(", ");
    if (type.parameters.length === 1 && parametersStrings.startsWith("...")) {
      return `{ parameters: ${parametersStrings.substring(3)}, result: ${
        renderTypeAsFfiBindings(
          dependencies,
          importMap,
          type.result,
          templateNameReplaceMap,
        )
      } }`;
    }
    return `{ parameters: [${parametersStrings}], result: ${
      renderTypeAsFfiBindings(
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
          ? renderTypeAsFfiBindings(
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
          renderTypeAsFfiBindings(
            dependencies,
            importMap,
            type.base,
            templateNameReplaceMap,
          ),
        ]
        : [])
        .concat(
          type.fields.map((field) =>
            renderTypeAsFfiBindings(
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
    const fieldString = renderTypeAsFfiBindings(
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
          renderTypeAsFfiBindings(
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
    const nameT = `${type.name}T`;
    importMap.set(nameT, typesFile(type.file));
    dependencies.add(nameT);
    return nameT;
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

const renderPointerAsFfi = (
  dependencies: Set<string>,
  importMap: ImportMap,
  pointee: "self" | TypeEntry,
  templateNameReplaceMap = EMPTY_MAP,
) => {
  if (typeof pointee === "string") {
    // Primitive value pointers are usually out pointers.
    importMap.set("buf", SYSTEM_TYPES);
    if (pointee === "self") {
      return `buf("self")`;
    }
    return `buf(${(renderTypeAsFfiBindings(
      dependencies,
      importMap,
      pointee,
      templateNameReplaceMap,
    ))})`;
  } else if (pointee.kind === "pointer") {
    // Pointer to pointer is usually an out pointer.
    importMap.set("buf", SYSTEM_TYPES);
    return `buf(${(renderTypeAsFfiBindings(
      dependencies,
      importMap,
      pointee,
      templateNameReplaceMap,
    ))})`;
  } else if (pointee.kind === "inline class<T>") {
    if (!pointee.specialization) {
      pointee.specialization = pointee.template.defaultSpecialization!;
    }
    if (
      !pointee.specialization.usedAsBuffer &&
      pointee.specialization.usedAsPointer
    ) {
      // Class template seen only as a pointer should use
      // pointers as FFI interface type.
      importMap.set("ptr", SYSTEM_TYPES);
      return `ptr(${(renderTypeAsFfiBindings(
        dependencies,
        importMap,
        pointee,
        templateNameReplaceMap,
      ))})`;
    }
    importMap.set("buf", SYSTEM_TYPES);
    return `buf(${
      renderTypeAsFfiBindings(
        dependencies,
        importMap,
        pointee,
        templateNameReplaceMap,
      )
    })`;
  } else if (
    pointee.kind === "class"
  ) {
    if (
      !pointee.usedAsBuffer &&
      pointee.usedAsPointer
    ) {
      // Class seen only as a pointer should use pointers as
      // FFI interface type.
      importMap.set("ptr", SYSTEM_TYPES);
      return `ptr(${(renderTypeAsFfiBindings(
        dependencies,
        importMap,
        pointee,
        templateNameReplaceMap,
      ))})`;
    }
    importMap.set("buf", SYSTEM_TYPES);
    return `buf(${(renderTypeAsFfiBindings(
      dependencies,
      importMap,
      pointee,
      templateNameReplaceMap,
    ))})`;
  } else if (pointee.kind === "function" || pointee.kind === "fn") {
    // Function pointer is just a function.
    return `func(${
      renderTypeAsFfiBindings(
        dependencies,
        importMap,
        pointee,
        templateNameReplaceMap,
      )
    })`;
  } else if (pointee.kind === "typedef") {
    const passByValue = isPassableByValue(pointee);
    if (passByValue) {
      importMap.set("buf", SYSTEM_TYPES);
    } else {
      importMap.set("ptr", SYSTEM_TYPES);
    }
    return passByValue
      ? `buf(${(renderTypeAsFfiBindings(
        dependencies,
        importMap,
        pointee,
        templateNameReplaceMap,
      ))})`
      : `ptr(${(renderTypeAsFfiBindings(
        dependencies,
        importMap,
        pointee,
        templateNameReplaceMap,
      ))})`;
  } else if (pointee.kind === "enum") {
    importMap.set("buf", SYSTEM_TYPES);
    return `buf(${(renderTypeAsFfiBindings(
      dependencies,
      importMap,
      pointee,
      templateNameReplaceMap,
    ))})`;
  } else if (
    pointee.kind === "inline class" || pointee.kind === "[N]"
  ) {
    if (isPassableByValue(pointee)) {
      return renderTypeAsFfiBindings(
        dependencies,
        importMap,
        "pointer",
        templateNameReplaceMap,
      );
    } else {
      return renderTypeAsFfiBindings(
        dependencies,
        importMap,
        "buffer",
        templateNameReplaceMap,
      );
    }
  } else if (isStructLike(pointee)) {
    importMap.set("buf", SYSTEM_TYPES);
    return `buf(${(renderTypeAsFfiBindings(
      dependencies,
      importMap,
      pointee,
      templateNameReplaceMap,
    ))})`;
  } else {
    importMap.set("ptr", SYSTEM_TYPES);
    return `ptr(${(renderTypeAsFfiBindings(
      dependencies,
      importMap,
      pointee,
      templateNameReplaceMap,
    ))})`;
  }
};
