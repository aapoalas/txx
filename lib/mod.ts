import {
  basename,
  dirname,
  relative,
} from "https://deno.land/std@0.170.0/path/mod.ts";
import upperCase from "https://deno.land/x/case@2.1.1/upperCase.ts";
import {
  CXChildVisitResult,
  CXCursorKind,
} from "https://deno.land/x/libclang@1.0.0-beta.8/include/typeDefinitions.ts";
import {
  CXCursor,
  CXIndex,
} from "https://deno.land/x/libclang@1.0.0-beta.8/mod.ts";
import { Context } from "./Context.ts";
import {
  handleImports,
  renderFile,
  renderSystemFileConstant,
} from "./renderer.ts";
import {
  AbsoluteBindingsFilePath,
  AbsoluteClassesFilePath,
  AbsoluteFilePath,
  AbsoluteSystemBindingsFilePath,
  AbsoluteSystemClassesFilePath,
  AbsoluteSystemTypesFilePath,
  AbsoluteTypesFilePath,
  ExportConfiguration,
  ImportMap,
  RenderData,
  RenderDataEntry,
} from "./types.d.ts";
import {
  FFI,
  sortRenderDataEntries,
  SYSTEM_BINDINGS,
  SYSTEM_CLASSES,
  SYSTEM_TYPES,
} from "./utils.ts";

export const build = (configuration: ExportConfiguration) => {
  if (
    configuration.basePath.startsWith(configuration.outputPath)
  ) {
    throw new Error(
      "Base path is inside the output path",
    );
  }
  const includesFileName = Deno.makeTempFileSync();
  if (new Set(configuration.include).size !== configuration.include.length) {
    throw new Error(
      "Found duplicate include entries",
    );
  }
  if (new Set(configuration.files).size !== configuration.files.length) {
    throw new Error(
      "Found duplicate file entries",
    );
  }
  Deno.writeTextFileSync(
    includesFileName,
    configuration.files.map((file) => `#include <${file}>\n`)
      .join(""),
  );

  const index = new CXIndex(true, true);

  const includes = configuration.include.map((name) => `-I${name}`);
  includes.push("-xc++");
  includes.push("-std=c++20");
  const tu = index.parseTranslationUnit(
    includesFileName,
    includes,
  );

  Deno.removeSync(includesFileName);

  const context = new Context();

  const tuCursor = tu.getCursor();

  gatherEntries(context, tuCursor);

  context.entriesGathered();

  for (const importEntry of configuration.imports) {
    if (importEntry.kind === "class") {
      context.visitClass(importEntry);
    } else if (importEntry.kind === "function") {
      context.visitFunction(importEntry);
    } else if (importEntry.kind === "var") {
      context.visitVar(importEntry);
    }
  }

  const usedData = context.getUsedData();
  const ffiExports = new Set<string>();
  const entriesNeededInSystem = new Set<string>();
  const files: RenderData[] = [];
  const outsideFiles: RenderData[] = [];
  for (const [file, data] of usedData) {
    const renderData = renderFile(file, data);
    for (const entry of renderData.bindings) {
      if (ffiExports.has(entry)) {
        throw new Error(`Duplicate export name '${entry}'`);
      }
      ffiExports.add(entry);
    }
    handleImports(
      configuration.basePath,
      entriesNeededInSystem,
      renderData.importsInBindingsFile,
    );
    handleImports(
      configuration.basePath,
      entriesNeededInSystem,
      renderData.importsInClassesFile,
    );
    handleImports(
      configuration.basePath,
      entriesNeededInSystem,
      renderData.importsInTypesFile,
    );
    if (renderData.bindingsFilePath.startsWith(configuration.basePath)) {
      files.push(renderData);
    } else {
      outsideFiles.push(renderData);
    }
  }

  const systemBindingsFilePath =
    `${configuration.basePath}/systemBindings.ts` as const;
  const systemClassesFilePath =
    `${configuration.basePath}/systemClasses.ts` as const;
  const systemTypesFilePath =
    `${configuration.basePath}/systemTypes.ts` as const;
  const entriesInSystemBindingsFile: RenderDataEntry[] = [];
  const entriesInSystemClassesFile: RenderDataEntry[] = [];
  const entriesInSystemTypesFile: RenderDataEntry[] = [];
  const importsInSystemBindingsFile: ImportMap = new Map();
  const importsInSystemClassesFile: ImportMap = new Map();
  const importsInSystemTypesFile: ImportMap = new Map();

  for (const entry of entriesNeededInSystem) {
    const result = renderSystemFileConstant(entry);
    if (
      result &&
      !entriesInSystemTypesFile.some((entry) =>
        entry.contents === result.contents
      )
    ) {
      entriesInSystemTypesFile.push(result);
    }
  }

  entriesInSystemTypesFile.sort();

  for (const outsideFile of outsideFiles) {
    entriesInSystemBindingsFile.push(...outsideFile.entriesInBindingsFile);
    entriesInSystemClassesFile.push(...outsideFile.entriesInClassesFile);
    entriesInSystemTypesFile.push(...outsideFile.entriesInTypesFile);
    for (const [key, value] of outsideFile.importsInBindingsFile) {
      importsInSystemBindingsFile.set(key, value);
    }
    for (const [key, value] of outsideFile.importsInClassesFile) {
      importsInSystemClassesFile.set(key, value);
    }
    for (const [key, value] of outsideFile.importsInTypesFile) {
      importsInSystemTypesFile.set(key, value);
    }
  }

  sortRenderDataEntries(entriesInSystemClassesFile);
  sortRenderDataEntries(entriesInSystemTypesFile);

  files.unshift({
    bindings: new Set(),
    bindingsFilePath: systemBindingsFilePath,
    classesFilePath: systemClassesFilePath,
    entriesInBindingsFile: entriesInSystemBindingsFile,
    entriesInClassesFile: entriesInSystemClassesFile,
    entriesInTypesFile: entriesInSystemTypesFile,
    importsInBindingsFile: importsInSystemBindingsFile,
    importsInClassesFile: importsInSystemClassesFile,
    importsInTypesFile: importsInSystemTypesFile,
    typesFilePath: systemTypesFilePath,
  });

  const pathData = {
    basePath: configuration.basePath,
    outputPath: configuration.outputPath,
    systemBindingsFilePath,
    systemClassesFilePath,
    systemTypesFilePath,
  };
  const bindingsImports: string[] = [];
  for (const file of files) {
    if (file.entriesInBindingsFile.length) {
      bindingsImports.push(file.bindingsFilePath);
    }
    writeFilesData(pathData, file);
  }

  const ffiFilePath = `${configuration.basePath}/ffi.ts`;
  Deno.writeTextFileSync(
    `${configuration.outputPath}/ffi.ts`,
    `${
      bindingsImports.map((filePath) =>
        `import * as ${
          upperCase(basename(filePath).replace(".h.ts", ""))
        } from "${makeRelative(relative(ffiFilePath, filePath)).substring(1)}";`
      ).join("\n")
    }
  
const lib = Deno.dlopen("FFIPATH", {
  ${
      bindingsImports.map((filePath) =>
        `...${upperCase(basename(filePath).replace(".h.ts", ""))}`
      )
        .join(",\n    ")
    }
  });;

${
      [...ffiExports].map((name) =>
        `export const ${name} = lib.symbols.${name};`
      ).join("\n")
    }`,
  );

  new Deno.Command("deno", { args: ["fmt", configuration.outputPath] })
    .outputSync();
};

const gatherEntries = (context: Context, parentCursor: CXCursor) =>
  void parentCursor.visitChildren((cursor) => {
    switch (cursor.kind) {
      case CXCursorKind.CXCursor_ClassTemplate:
        context.addClassTemplate(cursor);
        break;
      case CXCursorKind.CXCursor_ClassTemplatePartialSpecialization:
        context.addClassTemplatePartialSpecialization(cursor);
        break;
      case CXCursorKind.CXCursor_FunctionDecl:
        context.addFunction(cursor);
        break;
      case CXCursorKind.CXCursor_FunctionTemplate:
        /**
         * TODO: Support templates
         */
        break;
      case CXCursorKind.CXCursor_TypeAliasTemplateDecl:
        /**
         * TODO: Very advanced stuff
         *
         * @example
         * ```c++
         * template<bool _Cache>
         * using __ummap_traits = __detail::_Hashtable_traits<_Cache, false, false>;
         * ```
         */
        break;
      case CXCursorKind.CXCursor_UnionDecl:
        context.addUnion(cursor);
        break;
      case CXCursorKind.CXCursor_VarDecl:
        context.addVar(cursor);
        break;
      case CXCursorKind.CXCursor_Namespace:
        // Recurse into namespaces.
        context.pushToNamespaceStack(cursor.getSpelling());
        gatherEntries(context, cursor);
        context.popFromNamespaceStack();
        break;
      case CXCursorKind.CXCursor_ClassDecl:
      case CXCursorKind.CXCursor_StructDecl:
        if (!cursor.isDefinition()) {
          // Forward-declarations are meaningless
          break;
        }

        // Recurse into classes first and add all entries
        // defined within our class definition.
        context.pushToNamespaceStack(cursor.getSpelling());
        gatherEntries(context, cursor);
        context.popFromNamespaceStack();

        // Add the class only after
        context.addClass(cursor);
        break;
      case CXCursorKind.CXCursor_TypedefDecl:
      case CXCursorKind.CXCursor_TypeAliasDecl:
        context.addTypeDefinition(cursor);
        break;
      case CXCursorKind.CXCursor_EnumDecl:
        context.addEnum(cursor);
        break;
      case CXCursorKind.CXCursor_UnexposedDecl:
        // UnexposedDecl can be `extern "C"`, which we want to look
        // inside of. We can just recurse into it as it doesn't
        // move namespaces or anything.
        return CXChildVisitResult.CXChildVisit_Recurse;
    }
    return CXChildVisitResult.CXChildVisit_Continue;
  });

const writeFilesData = (
  pathData: {
    basePath: AbsoluteFilePath;
    outputPath: AbsoluteFilePath;
    systemBindingsFilePath:
      | AbsoluteBindingsFilePath
      | AbsoluteSystemBindingsFilePath;
    systemClassesFilePath:
      | AbsoluteClassesFilePath
      | AbsoluteSystemClassesFilePath;
    systemTypesFilePath: AbsoluteTypesFilePath | AbsoluteSystemTypesFilePath;
  },
  {
    bindingsFilePath,
    classesFilePath,
    entriesInBindingsFile,
    entriesInClassesFile,
    entriesInTypesFile,
    importsInBindingsFile,
    importsInClassesFile,
    importsInTypesFile,
    typesFilePath,
  }: RenderData,
) => {
  const {
    basePath,
  } = pathData;
  if (
    !bindingsFilePath.startsWith(basePath) ||
    !classesFilePath.startsWith(basePath) || !typesFilePath.startsWith(basePath)
  ) {
    throw new Error("Unexpected");
  }
  writeFileData(
    pathData,
    bindingsFilePath,
    importsInBindingsFile,
    entriesInBindingsFile,
  );
  writeFileData(
    pathData,
    classesFilePath,
    importsInClassesFile,
    entriesInClassesFile,
  );
  writeFileData(
    pathData,
    typesFilePath,
    importsInTypesFile,
    entriesInTypesFile,
  );
};

const collator = new Intl.Collator("en");

const compareStrings = (a: string, b: string) => {
  if (a.startsWith("type ")) {
    a = a.substring(5);
  }
  if (b.startsWith("type ")) {
    b = b.substring(5);
  }
  return collator.compare(a, b);
};

const writeFileData = (
  {
    basePath,
    outputPath,
    systemBindingsFilePath,
    systemClassesFilePath,
    systemTypesFilePath,
  }: {
    basePath: AbsoluteFilePath;
    outputPath: AbsoluteFilePath;
    systemBindingsFilePath:
      | AbsoluteBindingsFilePath
      | AbsoluteSystemBindingsFilePath;
    systemClassesFilePath:
      | AbsoluteClassesFilePath
      | AbsoluteSystemClassesFilePath;
    systemTypesFilePath: AbsoluteTypesFilePath | AbsoluteSystemTypesFilePath;
  },
  filePath: AbsoluteFilePath,
  importsInFile: ImportMap,
  entriesInFile: RenderDataEntry[],
) => {
  if (!entriesInFile.length) {
    return;
  }
  const importsInFileByFile = new Map<AbsoluteFilePath, string[]>();
  for (let [importString, importPath] of importsInFile) {
    if (importPath === SYSTEM_BINDINGS) {
      importPath = systemBindingsFilePath;
    } else if (importPath === SYSTEM_CLASSES) {
      importPath = systemClassesFilePath;
    } else if (importPath === SYSTEM_TYPES) {
      importPath = systemTypesFilePath;
    } else if (importPath === FFI) {
      importPath = `${basePath}/ffi.ts` as const;
    }
    if (importPath === filePath) {
      continue;
    }
    const importsList = importsInFileByFile.get(importPath) ||
      importsInFileByFile.set(importPath, []).get(importPath)!;
    importsList.push(importString);
  }

  const importEntries: string[] = [];
  for (
    const importPath of [...importsInFileByFile.keys()].sort(compareStrings)
  ) {
    const importsList = importsInFileByFile.get(importPath)!;
    importsList.sort(compareStrings);
    importEntries.push(
      `import { ${importsList.join(", ")} } from "${
        makeRelative(relative(dirname(filePath), importPath))
      }";`,
    );
  }

  if (importEntries.length) {
    importEntries.push("");
  }

  const fileContents = [
    ...importEntries,
    ...entriesInFile.map((entry) => entry.contents),
  ].join("\n");

  const outputFileName = filePath.replace(basePath, outputPath);

  Deno.mkdirSync(dirname(outputFileName), { recursive: true });
  Deno.writeTextFileSync(outputFileName, fileContents);
};

const makeRelative = (path: string) =>
  !path.startsWith(".") ? `./${path}` : path;
