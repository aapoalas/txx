import { renderClass } from "./renderers/Class.ts";
import { renderClassTemplate } from "./renderers/ClassTemplate.ts";
import { renderEnum } from "./renderers/Enum.ts";
import { renderFunction } from "./renderers/Function.ts";
import { renderTypedef } from "./renderers/Typedef.ts";
import { renderUnion } from "./renderers/Union.ts";
import {
  AbsoluteFilePath,
  ImportMap,
  RenderData,
  RenderDataEntry,
  UseableEntry,
} from "./types.d.ts";
import {
  bindingsFile,
  classesFile,
  FFI,
  sortRenderDataEntries,
  SYSTEM_BINDINGS,
  SYSTEM_CLASSES,
  SYSTEM_TYPES,
  typesFile,
} from "./utils.ts";

export const renderFile = (
  filePath: AbsoluteFilePath,
  data: UseableEntry[],
) => {
  const bindingsFilePath = bindingsFile(filePath);
  const classesFilePath = classesFile(filePath);
  const typesFilePath = typesFile(filePath);
  const importsInBindingsFile: ImportMap = new Map();
  const importsInClassesFile: ImportMap = new Map();
  const importsInTypesFile: ImportMap = new Map();
  const entriesInBindingsFile: RenderDataEntry[] = [];
  const entriesInClassesFile: RenderDataEntry[] = [];
  const entriesInTypesFile: RenderDataEntry[] = [];
  const memory: RenderData = {
    bindings: new Set(),
    bindingsFilePath,
    classesFilePath,
    typesFilePath,
    importsInBindingsFile,
    importsInClassesFile,
    importsInTypesFile,
    entriesInBindingsFile,
    entriesInClassesFile,
    entriesInTypesFile,
  };

  for (const entry of data) {
    switch (entry.kind) {
      case "enum":
        renderEnum(memory, entry);
        break;
      case "function":
        renderFunction(memory, entry);
        break;
      case "class":
        renderClass(memory, entry);
        break;
      case "class<T>":
        renderClassTemplate(memory, entry);
        break;
      case "typedef":
        renderTypedef(memory, entry);
        break;
      case "union":
        renderUnion(memory, entry);
        break;
    }
  }

  sortRenderDataEntries(entriesInClassesFile);
  sortRenderDataEntries(entriesInTypesFile);

  return memory;
};

export const handleImports = (
  basePath: AbsoluteFilePath,
  memory: Set<string>,
  importMap: ImportMap,
) => {
  for (const [importString, importPath] of importMap) {
    if (
      importString.startsWith("type ") &&
      importMap.has(importString.substring(5))
    ) {
      // Do not import `type Foo` if `Foo` is also needed.
      importMap.delete(importString);
      continue;
    }
    if (!importPath.startsWith("#") && !importPath.endsWith(".ts")) {
      throw new Error(
        `Invalid import path: 'import { ${importString} } from "${importPath}";'`,
      );
    }
    if (importPath === SYSTEM_TYPES) {
      // Gather up imports used from "system"
      memory.add(importString);
    } else if (importPath !== FFI && !importPath.startsWith(basePath)) {
      // Import from outside the base path: These are redirected
      // to the #SYSTEM files
      if (importPath.endsWith(".classes.ts")) {
        importMap.set(importString, SYSTEM_CLASSES);
      } else if (importPath.endsWith(".types.ts")) {
        importMap.set(importString, SYSTEM_TYPES);
      } else {
        importMap.set(importString, SYSTEM_BINDINGS);
      }
    }
  }
};

export const renderSystemFileConstant = (constant: string): RenderDataEntry => {
  let contents: string;
  switch (constant) {
    case "buf":
      contents = `export const buf = (_: unknown) => "buffer" as const;
`;
      break;
    case "ptr":
      contents = `export const ptr = (_: unknown) => "pointer" as const;
`;
      break;
    case "func":
      contents = `export const func = (_?: unknown) => "function" as const;
`;
      break;
    case "union2":
      contents =
        `export const union2 = <const T, const U>(a: T, _b: U): T | U => a;
`;
      break;
    case "union3":
      contents =
        `export const union3 = <const T, const U, const V>(a: T, _b: U, _c: V): T | U | V => a;
`;
      break;
    case "union4":
      contents =
        `export const union4 = <const T, const U, const V, const W>(a: T, _b: U, _c: V, _d: W): T | U | V | W => a;
`;
      break;
    case "union5":
      contents =
        `export const union5 = <const T, const U, const V, const W, const X>(a: T, _b: U, _c: V, _d: W, _e: X): T | U | V | W | X => a;
`;
      break;
    case "cstringT":
      contents = `export const cstringT = "buffer";
`;
      break;
    case "cstringArrayT":
      contents = `export const cstringT = "buffer";
`;
      break;
    default:
      if (constant.startsWith("union")) {
        contents =
          `export const ${constant} = (...args: unknown[]) => args[0] as { struct: string[] };`;
      } else {
        throw new Error(`Unsupported file system constant '${constant}`);
      }
  }
  return {
    contents,
    dependencies: [],
    names: [constant],
  };
};
