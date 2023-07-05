import { ImportMap, TypedefEntry, TypeEntry } from "../../types.d.ts";
import {
  classesFile,
  isFunction,
  isInlineTemplateStruct,
  isPassableByValue,
  isStruct,
  isStructLike,
  typesFile,
} from "../../utils.ts";
import { renderTypeAsFfiBindingTypes } from "./asFfiBindingTypes.ts";

export const renderTypeAsTS = (
  dependencies: Set<string>,
  importMap: ImportMap,
  type: null | TypeEntry,
  {
    intoJS = false,
  }: {
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
        if (intoJS) {
          return "Deno.PointerValue";
        }
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
      // Self can only appear in callback definitions of classes.
      return "Deno.PointerValue";
    }
    if (isStruct(type.pointee)) {
      if (intoJS || !type.pointee.usedAsBuffer && type.pointee.usedAsPointer) {
        // Pointer to struct coming to JS: This is always a pointer object.
        // Otherwise if the pointer to a struct is leaving JS and the struct
        // is only ever seen as a pointer, use a pointer object.
        const namePointer = `${type.pointee.name}Pointer`;
        importMap.set(`type ${namePointer}`, typesFile(type.pointee.file));
        dependencies.add(namePointer);
        return namePointer;
      } else {
        // Otherwise us a buffer.
        const nameBuffer = `${type.pointee.name}Buffer`;
        importMap.set(
          `type ${nameBuffer}`,
          classesFile(type.pointee.file),
        );
        dependencies.add(nameBuffer);
        return nameBuffer;
      }
    } else if (isInlineTemplateStruct(type.pointee)) {
      if (!type.pointee.specialization) {
        type.pointee.specialization = type.pointee.template
          .defaultSpecialization!;
      }
      if (
        intoJS ||
        !type.pointee.specialization.usedAsBuffer &&
          type.pointee.specialization.usedAsPointer
      ) {
        // Pointer to struct coming to JS: This is always a pointer object.
        // Otherwise if the pointer to a struct is leaving JS and the struct
        // is only ever seen as a pointer, use a pointer object.
        const namePointer = `${type.pointee.name}Pointer`;
        importMap.set(`type ${namePointer}`, typesFile(type.pointee.file));
        dependencies.add(namePointer);
        return `${namePointer}<${
          type.pointee.parameters.map((param) =>
            param.kind === "<T>"
              ? renderTypeAsFfiBindingTypes(dependencies, importMap, param)
              : renderTypeAsFfiBindingTypes(dependencies, importMap, param.type)
          )
        }>`;
      } else {
        // Otherwise us a buffer.
        const nameBuffer = `${type.pointee.name}Buffer`;
        importMap.set(
          `type ${nameBuffer}`,
          classesFile(type.pointee.file),
        );
        dependencies.add(nameBuffer);
        return `${nameBuffer}<${
          type.pointee.parameters.map((param) =>
            param.kind === "<T>"
              ? renderTypeAsFfiBindingTypes(dependencies, importMap, param)
              : renderTypeAsFfiBindingTypes(dependencies, importMap, param.type)
          )
        }>`;
      }
    }
    if (isStructLike(type.pointee) && type.pointee.name) {
      if (intoJS) {
        const namePointer = `${type.pointee.name}Pointer`;
        importMap.set(`type ${namePointer}`, typesFile(type.pointee.file));
        dependencies.add(namePointer);
        return namePointer;
      } else {
        const nameBuffer = `${type.pointee.name}Buffer`;
        importMap.set(
          `type ${nameBuffer}`,
          classesFile(type.pointee.file),
        );
        dependencies.add(nameBuffer);
        return nameBuffer;
      }
    } else if (isFunction(type.pointee)) {
      return renderTypeAsTS(dependencies, importMap, type.pointee);
    }
    return "Deno.PointerValue";
  } else if (type.kind === "class") {
    // If class is only seen used as a pointer, then always expect it as a pointer.
    const usePointer = isPassableByValue(type) &&
      (intoJS || !type.usedAsBuffer && type.usedAsPointer);
    const name = usePointer ? `${type.name}Pointer` : `${type.name}Buffer`;
    importMap.set(
      usePointer ? `type ${name}` : name,
      classesFile(type.file),
    );
    dependencies.add(name);
    return name;
  } else if (type.kind === "inline class<T>") {
    const nameBuffer = `${
      type.specialization?.name || type.template.name
    }Buffer`;
    importMap.set(nameBuffer, classesFile(type.file));
    dependencies.add(nameBuffer);
    return `${nameBuffer}<${
      type.parameters.map((param) =>
        param.kind === "<T>"
          ? renderTypeAsFfiBindingTypes(dependencies, importMap, param)
          : renderTypeAsFfiBindingTypes(dependencies, importMap, param.type)
      )
    }>`;
  } else if (
    type.kind === "inline class" ||
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
