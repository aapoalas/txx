import constantCase from "https://deno.land/x/case@2.1.1/constantCase.ts";
import { RenderData, TypedefEntry } from "../types.d.ts";
import {
  classesFile,
  createRenderDataEntry,
  isConstantArray,
  isFunction,
  isInlineStruct,
  isInlineTemplateStruct,
  isPointer,
  isStruct,
  isStructLike,
  isTypedef,
  typesFile,
} from "../utils.ts";
import { renderTypeAsFfi, renderTypeAsTS } from "./Type.ts";

export const renderTypedef = (
  {
    entriesInClassesFile,
    entriesInTypesFile,
    importsInClassesFile,
    importsInTypesFile,
    typesFilePath,
  }: RenderData,
  entry: TypedefEntry,
) => {
  const {
    name,
    target,
  } = entry;
  if (!target) {
    throw new Error("Void typedef");
  }

  const nameT = `${name}T`;
  const namePointer = `${name}Pointer`;
  const nameBuffer = `${name}Buffer`;
  const dependencies = new Set<string>();
  if (typeof target === "string") {
    const typesDefinition = `export const ${nameT} = ${
      renderTypeAsFfi(dependencies, importsInTypesFile, target)
    };
export type ${name} = ${
      renderTypeAsTS(dependencies, importsInTypesFile, target)
    };
`;
    entriesInTypesFile.push(
      createRenderDataEntry([nameT, name], [...dependencies], typesDefinition),
    );
    return;
  }
  if (
    target && typeof target === "object" &&
    target.name === name &&
    "file" in target && target.file === entry.file
  ) {
    /**
     * De-namespacing:
     * ```cpp
     * namespace Internal {
     *   enum Foo {
     *     Bar,
     *   };
     * }
     * using Foo = Internal::Foo;
     * ```
     */
    return;
  }

  if (isTypedef(target)) {
    const targetName = target.name;
    const targetBuffer = `${targetName}Buffer`;
    const targetPointer = `${targetName}Pointer`;
    const targetT = `${targetName}T`;

    if (isStructLike(target.target)) {
      importsInClassesFile.set(
        targetBuffer,
        classesFile(target.file),
      );
      importsInTypesFile.set(
        `type ${targetPointer}`,
        typesFile(target.file),
      );
      importsInTypesFile.set(
        targetT,
        typesFile(target.file),
      );
      entriesInClassesFile.push(
        createRenderDataEntry(
          [nameBuffer],
          [targetBuffer],
          `export const ${nameBuffer} = ${targetBuffer};
`,
        ),
      );
      entriesInTypesFile.push(
        createRenderDataEntry(
          [nameT, namePointer],
          [targetT, targetPointer],
          `export const ${nameT} = ${targetT};
export type ${namePointer} = ${targetPointer};
`,
        ),
      );
    } else {
      importsInTypesFile.set(
        `type ${targetName}`,
        typesFile(target.file),
      );
      importsInTypesFile.set(
        targetT,
        typesFile(target.file),
      );
      entriesInTypesFile.push(
        createRenderDataEntry(
          [nameT, name],
          [targetT, targetName],
          `
export const ${nameT} = ${targetT};
export type ${name} = ${targetName};
`,
        ),
      );
    }
    return;
  }

  if (
    isInlineTemplateStruct(target)
  ) {
    const BUFFER_SIZE = `${constantCase(name)}_SIZE`;
    importsInClassesFile.set(BUFFER_SIZE, typesFilePath);
    const nameBuffer = `${name}Buffer`;
    const classesEntry = createRenderDataEntry(
      [nameBuffer],
      [],
      `export class ${nameBuffer} extends Uint8Array {
  constructor(arg?: ArrayBufferLike | number) {
    if (typeof arg === "undefined") {
      super(${BUFFER_SIZE})
      return;
    } else if (typeof arg === "number") {
      if (!Number.isFinite(arg) || arg < ${BUFFER_SIZE}) {
        throw new Error(
          "Invalid construction of ${nameBuffer}: Size is not finite or is too small",
        );
      }
      super(arg);
      return;
    }
    if (arg.byteLength < ${BUFFER_SIZE}) {
      throw new Error(
        "Invalid construction of ${nameBuffer}: Buffer size is too small",
      );
    }
    super(arg);
  }
}
`,
    );
    entriesInClassesFile.push(
      classesEntry,
    );
    const asConst = isInlineTemplateStruct(target) ? "" : " as const";
    const NAME_SIZE = `${constantCase(name)}_SIZE`;
    const typesEntry = createRenderDataEntry(
      [NAME_SIZE, nameT, namePointer],
      [...dependencies],
      `export const ${NAME_SIZE} = ${
        entry.cursor.getType()!.getSizeOf()
      } as const;
export const ${nameT} = ${
        renderTypeAsFfi(
          dependencies,
          importsInTypesFile,
          target,
        )
      }${asConst};
declare const ${name}: unique symbol;
export type ${namePointer} = NonNullable<Deno.PointerValue> & { [${name}]: unknown };
`,
    );
    entriesInTypesFile.push(typesEntry);
    return;
  }
  if (
    isStructLike(target) && name && "file" in target
  ) {
    const targetName = target.name;
    const targetBuffer = `${targetName}Buffer`;
    const targetPointer = `${targetName}Pointer`;
    const targetT = `${targetName}T`;
    importsInClassesFile.set(
      targetBuffer,
      classesFile(target.file),
    );
    importsInTypesFile.set(
      targetT,
      typesFile(target.file),
    );
    importsInTypesFile.set(
      targetPointer,
      typesFile(target.file),
    );
    entriesInTypesFile.push(
      createRenderDataEntry(
        [nameT, namePointer],
        [targetT, targetPointer],
        `export const ${nameT} = ${targetT};
export type ${namePointer} = ${targetPointer};
`,
      ),
    );
    entriesInClassesFile.push(
      createRenderDataEntry(
        [nameBuffer],
        [targetBuffer],
        `export const ${nameBuffer} = ${targetBuffer};
`,
      ),
    );
    return;
  }

  const refT = renderTypeAsFfi(
    dependencies,
    importsInTypesFile,
    isPointer(target) && isFunction(target.pointee) ? target.pointee : target,
  );
  if (
    (isStruct(target) || isInlineStruct(target) ||
      isInlineTemplateStruct(target) ||
      isConstantArray(target)) &&
    entry.cursor.getType()!.getSizeOf() > 0
  ) {
    const BUFFER_SIZE = `${constantCase(name)}_SIZE`;
    importsInClassesFile.set(BUFFER_SIZE, typesFilePath);
    const nameBuffer = `${name}Buffer`;
    const classesEntry = createRenderDataEntry(
      [nameBuffer],
      [],
      `export class ${nameBuffer} extends Uint8Array {
  constructor(arg?: ArrayBufferLike | number) {
    if (typeof arg === "undefined") {
      super(${BUFFER_SIZE})
      return;
    } else if (typeof arg === "number") {
      if (!Number.isFinite(arg) || arg < ${BUFFER_SIZE}) {
        throw new Error(
          "Invalid construction of ${nameBuffer}: Size is not finite or is too small",
        );
      }
      super(arg);
      return;
    }
    if (arg.byteLength < ${BUFFER_SIZE}) {
      throw new Error(
        "Invalid construction of ${nameBuffer}: Buffer size is too small",
      );
    }
    super(arg);
  }
}
`,
    );
    entriesInClassesFile.push(
      classesEntry,
    );
    const asConst = isInlineTemplateStruct(target) ? "" : " as const";
    const NAME_SIZE = `${constantCase(name)}_SIZE`;
    const typesEntry = createRenderDataEntry(
      [NAME_SIZE, nameT, namePointer],
      [...dependencies],
      `export const ${NAME_SIZE} = ${
        entry.cursor.getType()!.getSizeOf()
      } as const;
export const ${nameT} = ${refT}${asConst};
declare const ${name}: unique symbol;
export type ${namePointer} = NonNullable<Deno.PointerValue> & { [${name}]: unknown };
`,
    );
    entriesInTypesFile.push(typesEntry);
    return;
  }

  if (isFunction(target) || isPointer(target) && isFunction(target.pointee)) {
    entriesInTypesFile.push(
      createRenderDataEntry(
        [nameT, name],
        [...dependencies],
        `export const ${nameT} = ${refT} as const;
declare const ${name}_: unique symbol;
export type ${name} = NonNullable<Deno.PointerValue> & { [${name}_]: unknown };
`,
      ),
    );
    return;
  }
  const ref = renderTypeAsTS(dependencies, importsInTypesFile, target);
  const typesDefinition = `export const ${nameT} = ${refT}${
    refT.endsWith("}") ? " as const" : ""
  };
export type ${name} = ${ref};
`;
  entriesInTypesFile.push(
    createRenderDataEntry([nameT, name], [...dependencies], typesDefinition),
  );
};
