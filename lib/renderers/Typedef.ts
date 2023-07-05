import constantCase from "https://deno.land/x/case@2.1.1/constantCase.ts";
import {
  ClassEntry,
  ConstantArrayTypeEntry,
  FunctionEntry,
  FunctionTypeEntry,
  InlineClassTemplateTypeEntry,
  InlineClassTypeEntry,
  PlainTypeString,
  RenderData,
  TypedefEntry,
} from "../types.d.ts";
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
  renderData: RenderData,
  entry: TypedefEntry,
) => {
  const {
    name,
    target,
  } = entry;
  if (!target) {
    throw new Error("Void typedef");
  }

  const {
    entriesInTypesFile,
    importsInTypesFile,
  } = renderData;

  const nameT = `${name}T`;
  const dependencies = new Set<string>();
  if (typeof target === "string") {
    return renderStaticTarget(renderData, name, target);
  }
  if (
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

  switch (target.kind) {
    case "function":
      renderFunctionTarget(renderData, name, target);
      return;
    case "pointer":
      if (isFunction(target.pointee)) {
        renderFunctionTarget(renderData, name, target.pointee);
        return;
      }
      break;
    case "typedef":
      renderTypedefTarget(renderData, name, target);
      return;
    case "class":
    case "class<T>":
    case "enum":
    case "[N]":
    case "fn":
    case "inline class":
    case "inline class<T>":
    case "inline union":
    case "member pointer":
    case "union":
  }
  if (isTypedef(target)) {
    return renderTypedefTarget(renderData, name, target);
  } else if (
    isInlineTemplateStruct(target)
  ) {
    return renderInlineTemplateTarget(renderData, name, target);
  } else if (
    isStruct(target)
  ) {
    return renderStruct(renderData, name, target);
  } else if (
    (isInlineStruct(target) ||
      isConstantArray(target)) &&
    entry.cursor.getType()!.getSizeOf() > 0
  ) {
    return renderInlineStructOrConstantArray(renderData, name, target);
  } else if (isFunction(target)) {
    return renderFunctionTarget(renderData, name, target);
  } else if (isPointer(target) && isFunction(target.pointee)) {
    return renderFunctionTarget(renderData, name, target.pointee);
  }

  const refT = renderTypeAsFfi(
    dependencies,
    importsInTypesFile,
    isPointer(target) && isFunction(target.pointee) ? target.pointee : target,
  );

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

const renderStaticTarget = (
  { entriesInTypesFile, importsInTypesFile }: RenderData,
  name: string,
  target: PlainTypeString,
) => {
  const nameT = `${name}T`;
  const dependencies = new Set<string>();
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
};

const renderTypedefTarget = (
  {
    entriesInClassesFile,
    entriesInTypesFile,
    importsInClassesFile,
    importsInTypesFile,
  }: RenderData,
  name: string,
  target: TypedefEntry,
) => {
  const nameT = `${name}T`;
  const targetName = target.name;
  const nameBuffer = `${name}Buffer`;
  const namePointer = `${name}Pointer`;
  const targetBuffer = `${target}Buffer`;
  const targetPointer = `${target}Pointer`;
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
};

const renderInlineTemplateTarget = (
  {
    entriesInClassesFile,
    entriesInTypesFile,
    importsInClassesFile,
    importsInTypesFile,
    typesFilePath,
  }: RenderData,
  name: string,
  target: InlineClassTemplateTypeEntry,
) => {
  const nameT = `${name}T`;
  const namePointer = `${name}Pointer`;
  const dependencies = new Set<string>();
  const BUFFER_SIZE = `${constantCase(name)}_SIZE`;
  importsInClassesFile.set(BUFFER_SIZE, typesFilePath);
  const nameBuffer = `${name}Buffer`;
  const classesEntry = createRenderDataEntry(
    [nameBuffer],
    [],
    `export class ${nameBuffer} extends Uint8Array {
  constructor(arg?: ArrayBufferLike | number) {
    if (typeof arg === "undefined") {
      super(${BUFFER_SIZE});
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
      target.cursor.getType()!.getSizeOf()
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
};

const renderStruct = (
  {
    entriesInClassesFile,
    entriesInTypesFile,
    importsInClassesFile,
    importsInTypesFile,
  }: RenderData,
  name: string,
  target: ClassEntry,
) => {
  const nameT = `${name}T`;
  const targetName = target.name;
  const nameBuffer = `${name}Buffer`;
  const namePointer = `${name}Pointer`;
  const targetBuffer = `${target}Buffer`;
  const targetPointer = `${target}Pointer`;
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
};

const renderInlineStructOrConstantArray = (
  {
    entriesInClassesFile,
    entriesInTypesFile,
    importsInClassesFile,
    importsInTypesFile,
    typesFilePath,
  }: RenderData,
  name: string,
  target: InlineClassTypeEntry | ConstantArrayTypeEntry,
) => {
  const nameT = `${name}T`;
  const nameBuffer = `${name}Buffer`;
  const namePointer = `${name}Pointer`;
  const dependencies = new Set<string>();
  const BUFFER_SIZE = `${constantCase(name)}_SIZE`;
  importsInClassesFile.set(BUFFER_SIZE, typesFilePath);
  const classesEntry = createRenderDataEntry(
    [nameBuffer],
    [],
    `export class ${nameBuffer} extends Uint8Array {
  constructor(arg?: ArrayBufferLike | number) {
    if (typeof arg === "undefined") {
      super(${BUFFER_SIZE});
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
  const refT = renderTypeAsFfi(
    dependencies,
    importsInTypesFile,
    target,
  );
  const asConst = isInlineTemplateStruct(target) ? "" : " as const";
  const NAME_SIZE = `${constantCase(name)}_SIZE`;
  const typesEntry = createRenderDataEntry(
    [NAME_SIZE, nameT, namePointer],
    [...dependencies],
    `export const ${NAME_SIZE} = ${target.type.getSizeOf()} as const;
export const ${nameT} = ${refT}${asConst};
declare const ${name}: unique symbol;
export type ${namePointer} = NonNullable<Deno.PointerValue> & { [${name}]: unknown };
`,
  );
  entriesInTypesFile.push(typesEntry);
  return;
};

const renderFunctionTarget = (
  {
    entriesInTypesFile,
    importsInTypesFile,
  }: RenderData,
  name: string,
  target: FunctionEntry | FunctionTypeEntry,
) => {
  const nameT = `${name}T`;
  const dependencies = new Set<string>();
  const refT = renderTypeAsFfi(dependencies, importsInTypesFile, target);
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
};
