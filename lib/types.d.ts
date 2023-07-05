import {
  CXCursor,
  CXType,
} from "https://deno.land/x/libclang@1.0.0-beta.8/mod.ts";

export type AbsoluteFilePath = `/${string}`;
export type AbsoluteBindingsFilePath = `/${string}.ts`;
export type AbsoluteClassesFilePath = `/${string}.classes.ts`;
export type AbsoluteTypesFilePath = `/${string}.types.ts`;

export type AbsoluteSystemBindingsFilePath = `/${string}/systemBindings.ts`;
export type AbsoluteSystemClassesFilePath = `/${string}/systemClasses.ts`;
export type AbsoluteSystemTypesFilePath = `/${string}/systemTypes.ts`;

export type SystemBindingsFileName = "#SYSTEM_B";
export type SystemClassesFileName = "#SYSTEM_C";
export type SystemTypesFileName = "#SYSTEM_T";
export type BindingsFileName = "#FFI";

export interface ExportConfiguration {
  /**
   * Determines the base path against which output files are generated.
   *
   * @example
   * If base path is set to '/path/to/cpp/sources' and a file
   * '/path/to/cpp/sources/include/main/header.h' is encountered
   * then in the output folder the generated file will be eg.
   * 'include/main/header.h.ts'.
   *
   * Any needed types from files outside the base path get rolled into
   * the generic "system" files generated at the root of the output path.
   */
  basePath: AbsoluteFilePath;
  /**
   * Determines the folder into which output files are generated.
   */
  outputPath: AbsoluteFilePath;
  /**
   * Determines which C++ classes and others are considered "entry points"
   * into the headers. Only these entries and anything they depend on will
   * be generated in the output files.
   */
  imports: ImportContent[];
  /**
   * Determines which C++ header files are initially included into the build.
   *
   * Any inclusions these files do will of course be included into the build.
   * This list only serves to give a starting point for the build.
   */
  files: string[];
  /**
   * Determines where Clang will search for included headers.
   *
   * These get directly passed to Clang as `-I` (include path) parameters.
   */
  include: string[];
}

export interface ClassContent {
  kind: "class";
  name: string;
  destructors: boolean;
  constructors: boolean | ConstructorFilter;
  methods: boolean | string[] | MethodFilter;
  contents?: ClassContent[];
}

export type ConstructorFilter = (cursor: CXCursor) => boolean;

export interface MethodContent {
  name: string;
}

export type MethodFilter = (name: string, cursor: CXCursor) => boolean;

export interface FunctionContent {
  kind: "function";
  name: string;
}

export interface VarContent {
  kind: "var";
  name: string;
}

export type ImportContent = ClassContent | FunctionContent | VarContent;

export interface BaseEntry {
  cursor: CXCursor;
  file: AbsoluteFilePath;
  name: string;
  nsName: string;
  used: boolean;
}

export interface ClassEntry extends BaseEntry {
  kind: "class";
  bases: BaseClassEntry[];
  constructors: ClassConstructor[];
  destructor: null | ClassDestructor;
  fields: ClassField[];
  forwardDeclarations: CXCursor[];
  methods: ClassMethod[];
  size: number;
  virtualBases: BaseClassEntry[];
  usedAsPointer: boolean;
  usedAsBuffer: boolean;
}

export interface ClassConstructor {
  parameters: Parameter[];
  cursor: CXCursor;
  manglings: string[];
}

export interface ClassDestructor {
  cursor: CXCursor;
  manglings: string[];
}

export interface ClassField {
  name: string;
  cursor: CXCursor;
  type: TypeEntry;
}

export interface ClassMethod {
  parameters: Parameter[];
  cursor: CXCursor;
  mangling: string;
  name: string;
  result: null | TypeEntry;
}

export type BaseClassEntry =
  | ClassEntry
  | InlineClassTemplateTypeEntry
  | TypedefEntry;

export interface ClassTemplateEntry extends BaseEntry {
  defaultSpecialization: null | ClassTemplatePartialSpecialization;
  forwardDeclarations: CXCursor[];
  kind: "class<T>";
  parameters: TemplateParameter[];
  partialSpecializations: ClassTemplatePartialSpecialization[];
}

export interface ClassTemplatePartialSpecialization {
  name: string;
  application: TypeEntry[];
  kind: "partial class<T>";
  constructors: ClassConstructor[];
  destructor: null | ClassDestructor;
  bases: BaseClassEntry[];
  cursor: CXCursor;
  fields: ClassField[];
  methods: ClassMethod[];
  parameters: TemplateParameter[];
  used: boolean;
  usedAsPointer: boolean;
  usedAsBuffer: boolean;
  virtualBases: BaseClassEntry[];
}

export interface ClassTemplateConstructor {
  parameters: Parameter[];
  cursor: CXCursor;
  manglings: string[];
}

export interface ClassTemplateDestructor {
  cursor: CXCursor;
  manglings: string[];
}

export interface ClassTemplateField {
  name: string;
  cursor: CXCursor;
  type: TypeEntry;
}

export interface ClassTemplateMethod {
  parameters: Parameter[];
  cursor: CXCursor;
  mangling: string;
  name: string;
  result: null | TypeEntry;
}

export interface TemplateParameter {
  name: string;
  kind: "<T>";
  isSpread: boolean;
  isRef: boolean;
}

export interface Parameter {
  kind: "parameter";
  comment: null | string;
  name: string;
  type: TypeEntry;
}

export interface ConstantArrayTypeEntry {
  name?: never;
  kind: "[N]";
  length: number;
  element: TypeEntry;
  type: CXType;
}

export interface FunctionTypeEntry {
  name?: never;
  kind: "fn";
  parameters: Parameter[];
  result: null | TypeEntry;
  type: CXType;
}

export interface InlineClassTypeEntry {
  base: null | BaseClassEntry;
  fields: ClassField[];
  kind: "inline class";
  name?: never;
  type: CXType;
}

export interface InlineClassTemplateTypeEntry {
  cursor: CXCursor;
  file: AbsoluteFilePath;
  kind: "inline class<T>";
  name?: string;
  nsName?: string;
  parameters: (Parameter | TemplateParameter)[];
  template: ClassTemplateEntry;
  specialization: null | ClassTemplatePartialSpecialization;
  type: CXType;
}

export interface InlineUnionTypeEntry {
  name?: never;
  kind: "inline union";
  fields: ClassField[];
  type: CXType;
}

export interface MemberPointerTypeEntry {
  name?: never;
  kind: "member pointer";
  type: CXType;
}

export interface PointerTypeEntry {
  name?: never;
  kind: "pointer";
  pointee: "self" | TypeEntry;
  type: CXType;
}

export type PlainTypeString =
  | "bool"
  | "f32"
  | "f64"
  | "u8"
  | "i8"
  | "u16"
  | "i16"
  | "u32"
  | "i32"
  | "u64"
  | "i64"
  | "buffer"
  | "pointer"
  | "cstring"
  | "cstringArray";

export type TypeEntry =
  | PlainTypeString
  | ClassEntry
  | ClassTemplateEntry
  | FunctionEntry
  | EnumEntry
  | ConstantArrayTypeEntry
  | FunctionTypeEntry
  | InlineClassTypeEntry
  | InlineClassTemplateTypeEntry
  | InlineUnionTypeEntry
  | MemberPointerTypeEntry
  | PointerTypeEntry
  | TemplateParameter
  | TypedefEntry
  | UnionEntry;

export interface EnumEntry extends BaseEntry {
  kind: "enum";
  type: null | TypeEntry;
}

export interface FunctionEntry extends BaseEntry {
  kind: "function";
  parameters: Parameter[];
  mangling: string;
  result: null | TypeEntry;
}

export interface TypedefEntry extends BaseEntry {
  kind: "typedef";
  target: null | TypeEntry;
}

export interface VarEntry extends BaseEntry {
  kind: "var";
  mangling: string;
  type: null | TypeEntry;
}

export interface UnionEntry extends BaseEntry {
  kind: "union";
  fields: TypeEntry[];
}

export type UseableEntry =
  | ClassEntry
  | ClassTemplateEntry
  | EnumEntry
  | FunctionEntry
  | TypedefEntry
  | UnionEntry
  | VarEntry;

export type ImportMap = Map<
  string,
  | AbsoluteBindingsFilePath
  | AbsoluteClassesFilePath
  | AbsoluteTypesFilePath
  | SystemBindingsFileName
  | SystemClassesFileName
  | SystemTypesFileName
  | BindingsFileName
>;

export interface RenderDataEntry {
  contents: string;
  names: string[];
  dependencies: string[];
}

export interface RenderData {
  bindings: Set<string>;
  bindingsFilePath: AbsoluteBindingsFilePath | AbsoluteSystemBindingsFilePath;
  classesFilePath: AbsoluteClassesFilePath | AbsoluteSystemClassesFilePath;
  typesFilePath: AbsoluteTypesFilePath | AbsoluteSystemTypesFilePath;
  entriesInBindingsFile: RenderDataEntry[];
  entriesInClassesFile: RenderDataEntry[];
  entriesInTypesFile: RenderDataEntry[];
  importsInBindingsFile: ImportMap;
  importsInClassesFile: ImportMap;
  importsInTypesFile: ImportMap;
}
