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

export const renderTypeAsFfiBindingTypes = (
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
      importMap.set("Func", SYSTEM_TYPES);
      return `Func<typeof ${nameT}>`;
    }

    return nameT;
  } else if (type.kind === "pointer") {
    return renderPointerAsFfiBindingTypes(
      dependencies,
      importMap,
      type.pointee,
      templateNameReplaceMap,
    );
  } else if (type.kind === "function" || type.kind === "fn") {
    const parametersStrings = type.parameters.map((param) =>
      renderTypeAsFfiBindingTypes(
        dependencies,
        importMap,
        param.type,
        templateNameReplaceMap,
      )
    )
      .join(", ");
    if (type.parameters.length === 1 && parametersStrings.startsWith("...")) {
      return `{ parameters: ${parametersStrings.substring(3)}, result: ${
        renderTypeAsFfiBindingTypes(
          dependencies,
          importMap,
          type.result,
          templateNameReplaceMap,
        )
      } }`;
    }
    return `{ parameters: [${parametersStrings}], result: ${
      renderTypeAsFfiBindingTypes(
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
          ? renderTypeAsFfiBindingTypes(
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
          renderTypeAsFfiBindingTypes(
            dependencies,
            importMap,
            type.base,
            templateNameReplaceMap,
          ),
        ]
        : [])
        .concat(
          type.fields.map((field) =>
            renderTypeAsFfiBindingTypes(
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
    const fieldString = renderTypeAsFfiBindingTypes(
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
          renderTypeAsFfiBindingTypes(
            dependencies,
            importMap,
            field.type,
            templateNameReplaceMap,
          )
        ),
      ),
    ];
    return uniqueSortedFields.join(
      " | ",
    );
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
    importMap.set(`type ${nameT}`, typesFile(type.file));
    dependencies.add(nameT);

    return nameT;
  } else if (type.kind === "<T>") {
    if (type.isRef) {
      importMap.set("type Ptr", SYSTEM_TYPES);
    }
    const TypeName = templateNameReplaceMap.get(type.name) ||
      pascalCase(type.name);
    if (type.isSpread && type.isRef) {
      return `...Ptr<${TypeName}>[]`;
    } else if (type.isSpread) {
      return `...${TypeName}`;
    } else if (type.isRef) {
      return `Ptr<${TypeName}>`;
    }
    return TypeName;
  } else {
    throw new Error(
      // @ts-expect-error kind and name will exist in any added TypeEntry types
      "internal error: unknown type kind: " + type.kind + ": " + type.name,
    );
  }
};

const renderPointerAsFfiBindingTypes = (
  dependencies: Set<string>,
  importMap: ImportMap,
  pointee: "self" | TypeEntry,
  templateNameReplaceMap = EMPTY_MAP,
) => {
  if (typeof pointee === "string") {
    // Primitive value pointers are usually out pointers.
    importMap.set("type Buf", SYSTEM_TYPES);
    if (pointee === "self") {
      return `Buf<"self">`;
    }
    return `Buf<${(renderTypeAsFfiBindingTypes(
      dependencies,
      importMap,
      pointee,
      templateNameReplaceMap,
    ))}>`;
  } else if (pointee.kind === "pointer") {
    // Pointer to pointer is usually an out pointer.
    importMap.set("type Buf", SYSTEM_TYPES);
    return `Buf<${(renderTypeAsFfiBindingTypes(
      dependencies,
      importMap,
      pointee,
      templateNameReplaceMap,
    ))}>`;
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
      importMap.set("type Ptr", SYSTEM_TYPES);
      return `Ptr<${(renderTypeAsFfiBindingTypes(
        dependencies,
        importMap,
        pointee,
        templateNameReplaceMap,
      ))}>`;
    }
    importMap.set("type Buf", SYSTEM_TYPES);
    return `Buf<${
      renderTypeAsFfiBindingTypes(
        dependencies,
        importMap,
        pointee,
        templateNameReplaceMap,
      )
    }>`;
  } else if (
    pointee.kind === "class"
  ) {
    if (
      !pointee.usedAsBuffer &&
      pointee.usedAsPointer
    ) {
      // Class seen only as a pointer should use pointers as
      // FFI interface type.
      importMap.set("type Ptr", SYSTEM_TYPES);
      return `Ptr<${(renderTypeAsFfiBindingTypes(
        dependencies,
        importMap,
        pointee,
        templateNameReplaceMap,
      ))}>`;
    }
    importMap.set("type Buf", SYSTEM_TYPES);
    return `Buf<${(renderTypeAsFfiBindingTypes(
      dependencies,
      importMap,
      pointee,
      templateNameReplaceMap,
    ))}>`;
  } else if (pointee.kind === "function" || pointee.kind === "fn") {
    // Function pointer is just a function.
    return `Func<${
      renderTypeAsFfiBindingTypes(
        dependencies,
        importMap,
        pointee,
        templateNameReplaceMap,
      )
    }>`;
  } else if (pointee.kind === "typedef") {
    const passByValue = isPassableByValue(pointee);
    if (passByValue) {
      importMap.set("type Buf", SYSTEM_TYPES);
    } else {
      importMap.set("type Ptr", SYSTEM_TYPES);
    }
    return passByValue
      ? `Buf<${(renderTypeAsFfiBindingTypes(
        dependencies,
        importMap,
        pointee,
        templateNameReplaceMap,
      ))}>`
      : `Ptr<${(renderTypeAsFfiBindingTypes(
        dependencies,
        importMap,
        pointee,
        templateNameReplaceMap,
      ))}>`;
  } else if (pointee.kind === "enum") {
    importMap.set("type Buf", SYSTEM_TYPES);
    return `Buf<${(renderTypeAsFfiBindingTypes(
      dependencies,
      importMap,
      pointee,
      templateNameReplaceMap,
    ))}>`;
  } else if (
    pointee.kind === "inline class" || pointee.kind === "[N]"
  ) {
    if (isPassableByValue(pointee)) {
      return renderTypeAsFfiBindingTypes(
        dependencies,
        importMap,
        "pointer",
        templateNameReplaceMap,
      );
    } else {
      return renderTypeAsFfiBindingTypes(
        dependencies,
        importMap,
        "buffer",
        templateNameReplaceMap,
      );
    }
  } else if (isStructLike(pointee)) {
    importMap.set("type Buf", SYSTEM_TYPES);
    return `Buf<${(renderTypeAsFfiBindingTypes(
      dependencies,
      importMap,
      pointee,
      templateNameReplaceMap,
    ))}>`;
  } else {
    importMap.set("type Ptr", SYSTEM_TYPES);
    return `Ptr<${(renderTypeAsFfiBindingTypes(
      dependencies,
      importMap,
      pointee,
      templateNameReplaceMap,
    ))}>`;
  }
};
