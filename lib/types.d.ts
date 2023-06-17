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
  basePath: AbsoluteFilePath;
  outputPath: AbsoluteFilePath;
  imports: ImportContent[];
  files: string[];
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

export type ImportContent = ClassContent | FunctionContent;

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
  methods: ClassMethod[];
  size: number;
  virtualBases: BaseClassEntry[];
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
  kind: "class<T>";
  parameters: TemplateParameter[];
  defaultSpecialization: ClassTemplatePartialSpecialization;
  partialSpecializations: ClassTemplatePartialSpecialization[];
}

export interface ClassTemplatePartialSpecialization {
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
