import {
  CXChildVisitResult,
  CXCursorKind,
} from "https://deno.land/x/libclang@1.0.0-beta.8/include/typeDefinitions.ts";
import {
  CXCursor,
  CXType,
  CXTypeKind,
} from "https://deno.land/x/libclang@1.0.0-beta.8/mod.ts";
import { SEP } from "./Context.ts";
import type {
  AbsoluteBindingsFilePath,
  AbsoluteClassesFilePath,
  AbsoluteFilePath,
  AbsoluteTypesFilePath,
  ClassEntry,
  ConstantArrayTypeEntry,
  FunctionEntry,
  FunctionTypeEntry,
  InlineClassTemplateTypeEntry,
  InlineClassTypeEntry,
  InlineUnionTypeEntry,
  MemberPointerTypeEntry,
  PlainTypeString,
  PointerTypeEntry,
  RenderDataEntry,
  TypedefEntry,
  TypeEntry,
  UnionEntry,
} from "./types.d.ts";

export const SYSTEM_BINDINGS = "#SYSTEM_B" as const;
export const SYSTEM_CLASSES = "#SYSTEM_C" as const;
export const SYSTEM_TYPES = "#SYSTEM_T" as const;
export const FFI = "#FFI" as const;

export const getFileNameFromCursor = (cursor: CXCursor): AbsoluteFilePath =>
  cursor.getLocation().getFileLocation().file.getName() as AbsoluteFilePath;
export const getCursorFileLocation = (cursor: CXCursor): string => {
  const fileLocation = cursor.getLocation().getFileLocation();
  return `${fileLocation.file.getName()}:${fileLocation.line}:${fileLocation.column}`;
};

export const getCursorNameTemplatePart = (cursor: CXCursor) => {
  if (!cursor.getSpecializedTemplate()) {
    return "";
  }

  let nameTemplatePart = "";
  const type = cursor.getType();
  if (!type) {
    throw new Error("Should find a type");
  }
  nameTemplatePart = "<";
  const targc = type.getNumberOfTemplateArguments();
  for (let i = 0; i < targc; i++) {
    if (i > 0) {
      nameTemplatePart += ", ";
    }
    const targ = type.getTemplateArgumentAsType(i);
    if (!targ) {
      nameTemplatePart += "unknown";
    } else {
      nameTemplatePart += targ.getSpelling();
    }
  }

  nameTemplatePart += ">";
  return nameTemplatePart;
};

export const getPlainTypeInfo = (
  typekind: CXTypeKind,
  type: CXType,
): null | PlainTypeString => {
  if (typekind === CXTypeKind.CXType_Void) {
    return null;
  } else if (typekind === CXTypeKind.CXType_Bool) {
    return "bool";
  } else if (typekind === CXTypeKind.CXType_Float) {
    if (type.getSizeOf() !== 4) {
      throw new Error(
        `Unexpected Float size: Expected 32, got ${type.getSizeOf() * 8}`,
      );
    }
    return "f32";
  } else if (typekind === CXTypeKind.CXType_Double) {
    if (type.getSizeOf() !== 8) {
      throw new Error(
        `Unexpected Double size: Expected 64, got ${type.getSizeOf() * 8}`,
      );
    }
    return "f64";
  } else if (typekind === CXTypeKind.CXType_NullPtr) {
    return "pointer";
  } else if (
    typekind === CXTypeKind.CXType_Char_U ||
    typekind === CXTypeKind.CXType_UChar ||
    typekind === CXTypeKind.CXType_UShort ||
    typekind === CXTypeKind.CXType_UInt ||
    typekind === CXTypeKind.CXType_ULong ||
    typekind === CXTypeKind.CXType_ULongLong
  ) {
    // Unsigned number, get size.
    const size = type.getSizeOf();
    if (size === 1) {
      return "u8";
    } else if (size === 2) {
      return "u16";
    } else if (size === 4) {
      return "u32";
    } else if (size === 8) {
      return "u64";
    } else {
      throw new Error(`Unexpected ${type.getKindSpelling()} size: Got ${size}`);
    }
  } else if (
    typekind === CXTypeKind.CXType_Char_S ||
    typekind === CXTypeKind.CXType_SChar ||
    typekind === CXTypeKind.CXType_Short ||
    typekind === CXTypeKind.CXType_Int ||
    typekind === CXTypeKind.CXType_Long ||
    typekind === CXTypeKind.CXType_LongLong
  ) {
    // Signed number, get size.
    const size = type.getSizeOf();
    if (size === 1) {
      return "i8";
    } else if (size === 2) {
      return "i16";
    } else if (size === 4) {
      return "i32";
    } else if (size === 8) {
      return "i64";
    } else {
      throw new Error(`Unexpected ${type.getKindSpelling()} size: Got ${size}`);
    }
  } else {
    throw new Error(`Unexpected type kind: ${type.getKindSpelling()}`);
  }
};

export const isPassedInRegisters = (entry: TypeEntry): boolean => {
  if (typeof entry === "string" || entry === null) {
    return true;
  }
  if ("cursor" in entry) {
    if (
      entry.cursor.kind === CXCursorKind.CXCursor_TypedefDecl ||
      entry.cursor.kind === CXCursorKind.CXCursor_TypeAliasDecl
    ) {
      return isTypedefReturnedInRegisters(
        entry.cursor.getTypedefDeclarationOfUnderlyingType()!,
      );
    } else if (entry.cursor.kind === CXCursorKind.CXCursor_EnumDecl) {
      return true;
    }
    const canonicalType = entry.cursor.getType()!.getCanonicalType();
    const cursor = canonicalType.getTypeDeclaration()!;
    if (
      cursor.kind === CXCursorKind.CXCursor_ClassDecl ||
      cursor.kind === CXCursorKind.CXCursor_StructDecl
    ) {
      return isClassPassedInRegisters(cursor);
    }
    if (!canonicalType) {
      return false;
    }
    return canonicalType.isPODType();
  } else {
    if (!("type" in entry)) {
      return false;
    }
    const canonicalType = entry.type.getCanonicalType();
    return isTypedefReturnedInRegisters(canonicalType);
  }
};

const isClassPassedInRegisters = (
  cursor: CXCursor,
): boolean => {
  const result = cursor.visitChildren((child) => {
    if (child.kind === CXCursorKind.CXCursor_CXXBaseSpecifier) {
      if (!isClassPassedInRegisters(child.getDefinition()!)) {
        return CXChildVisitResult.CXChildVisit_Break;
      }
    } else if (
      child.kind === CXCursorKind.CXCursor_Constructor &&
        (child.isCopyConstructor() || child.isMoveConstructor()) ||
      child.kind === CXCursorKind.CXCursor_Destructor
    ) {
      // TODO: Should check if all constructors are deleted.
      return CXChildVisitResult.CXChildVisit_Break;
    } else if (
      child.kind === CXCursorKind.CXCursor_CXXMethod && child.isVirtual()
    ) {
      return CXChildVisitResult.CXChildVisit_Break;
    }
    return CXChildVisitResult.CXChildVisit_Continue;
  });

  if (result) {
    return false;
  }
  return true;
};

const isTypedefReturnedInRegisters = (
  type: CXType,
): boolean => {
  if (type.kind === CXTypeKind.CXType_Record) {
    return isClassPassedInRegisters(type.getTypeDeclaration()!);
  }
  return true;
};

export const getNamespacedName = (cursor: CXCursor): string => {
  const name = cursor.getSpelling();
  if (name.includes("<")) {
    throw new Error(
      "Do not try to get namespaced name of a templated instance",
    );
  }
  let parent: null | CXCursor = cursor.getSemanticParent();
  if (!parent) {
    return name;
  }
  const namespaceStack: string[] = [];
  let previousParent: null | CXCursor = null;
  while (parent && (!previousParent || !parent.equals(previousParent))) {
    if (parent.isTranslationUnit()) {
      break;
    }
    if (
      parent.kind === CXCursorKind.CXCursor_Namespace ||
      parent.kind === CXCursorKind.CXCursor_ClassDecl ||
      parent.kind === CXCursorKind.CXCursor_ClassTemplate
    ) {
      const parentName = parent.getSpelling();
      if (parentName) {
        namespaceStack.unshift(parentName);
      }
    }
    previousParent = parent;
    parent = parent.getSemanticParent();
    if (!parent || parent.isTranslationUnit()) {
      break;
    }
  }
  return namespaceStack.length > 0
    ? `${namespaceStack.join(SEP)}${SEP}${name}`
    : name;
};

/**
 * Create bindings file path from file path
 *
 * The bindings file only exports FFI symbol descriptions
 * for use in `Deno.dlopen()`.
 */
export const bindingsFile = (
  filePath: AbsoluteFilePath,
): AbsoluteBindingsFilePath => `${filePath}.ts` as const;
/**
 * Create classes file path from file path
 *
 * The classes file contains JavaScript class definitions
 * generated from the C++ header bindings and act as the
 * intended entry point into the library.
 */
export const classesFile = (
  filePath: AbsoluteFilePath,
): AbsoluteClassesFilePath => `${filePath}.classes.ts` as const;
/**
 * Create types file path from file path
 *
 * The types file contains FFI symbol type definitions
 * and TypeScript type definitions. The FFI symbol type
 * definitions are used in the bindings files and in other
 * FFI symbol type definitions. The TypeScript type definitions
 * are used in class files.
 */
export const typesFile = (filePath: AbsoluteFilePath): AbsoluteTypesFilePath =>
  `${filePath}.types.ts` as const;

export const isStructLike = (
  entry: null | "self" | TypeEntry,
): entry is
  | ConstantArrayTypeEntry
  | ClassEntry
  | InlineClassTypeEntry
  | InlineClassTemplateTypeEntry
  | InlineUnionTypeEntry
  | TypedefEntry =>
  entry !== null && typeof entry === "object" &&
  (entry.kind === "[N]" || entry.kind === "class" ||
    entry.kind === "inline class" || entry.kind === "inline class<T>" ||
    entry.kind === "inline union" ||
    entry.kind === "typedef" && isStructLike(entry.target));

export const isStruct = (
  entry: null | "self" | TypeEntry,
): entry is ClassEntry =>
  entry !== null && typeof entry === "object" &&
  entry.kind === "class";

export const isInlineStruct = (
  entry: null | "self" | TypeEntry,
): entry is InlineClassTypeEntry =>
  entry !== null && typeof entry === "object" &&
  entry.kind === "inline class";

export const isInlineTemplateStruct = (
  entry: null | "self" | TypeEntry,
): entry is InlineClassTemplateTypeEntry =>
  entry !== null && typeof entry === "object" &&
  entry.kind === "inline class<T>";

export const isConstantArray = (
  entry: null | "self" | TypeEntry,
): entry is ConstantArrayTypeEntry =>
  entry !== null && typeof entry === "object" &&
  entry.kind === "[N]";

export const isPointer = (
  entry: null | "self" | TypeEntry,
): entry is PointerTypeEntry =>
  entry !== null && typeof entry === "object" && entry.kind === "pointer";

export const isFunction = (
  entry: null | "self" | TypeEntry,
): entry is FunctionEntry | FunctionTypeEntry =>
  entry !== null && typeof entry === "object" &&
  (entry.kind === "function" || entry.kind === "fn");

export const isPointerToStructLike = (
  entry: null | "self" | TypeEntry,
): entry is PointerTypeEntry & {
  pointee:
    | ConstantArrayTypeEntry
    | ClassEntry
    | InlineClassTypeEntry
    | InlineClassTemplateTypeEntry
    | InlineUnionTypeEntry
    | TypedefEntry;
} =>
  isPointer(entry) && (entry.pointee === "self" || isStructLike(entry.pointee));

export const isStructOrTypedefStruct = (
  entry: null | "self" | TypeEntry,
): entry is ClassEntry | TypedefEntry =>
  isStruct(entry) ||
  isTypedef(entry) &&
    (isInlineStruct(entry.target) || isStructOrTypedefStruct(entry.target));

export const isTypedef = (
  entry: null | "self" | TypeEntry,
): entry is TypedefEntry =>
  entry !== null && typeof entry === "object" && entry.kind === "typedef";

export const isUnion = (
  entry: null | "self" | TypeEntry,
): entry is UnionEntry =>
  entry !== null && typeof entry === "object" && entry.kind === "union";

export const createRenderDataEntry = (
  names: string[] = [],
  dependencies: string[] = [],
  contents = "",
): RenderDataEntry => ({
  contents,
  dependencies,
  names,
});

export const createDummyRenderDataEntry = (
  contents: string,
): RenderDataEntry => ({
  contents,
  dependencies: [],
  names: [],
});

export const sortRenderDataEntries = (
  entries: RenderDataEntry[],
) => {
  for (let i = 0; i < entries.length;) {
    const entry = entries[i];
    const firstReferringIndex = entries.findIndex((prevEntry, index) =>
      index < i &&
      prevEntry.dependencies.length > 0 &&
      entry.names.some((name) => prevEntry.dependencies.includes(name))
    );

    if (firstReferringIndex !== -1) {
      // Earlier entry refers to this one: We need to move before it it.
      entries.splice(i, 1);
      entries.splice(firstReferringIndex, 0, entry);
    } else {
      // No need to move: Step to next.
      i++;
    }
  }
};

/**
 * Get size of TypeEntry in bytes
 */
export const getSizeOfType = (entry: null | TypeEntry): number => {
  if (entry === null) {
    return 1;
  } else if (typeof entry === "string") {
    switch (entry) {
      case "bool":
      case "u8":
      case "i8":
        return 1;
      case "u16":
      case "i16":
        return 2;
      case "f32":
      case "u32":
      case "i32":
        return 4;
      case "f64":
      case "u64":
      case "i64":
      case "buffer":
      case "pointer":
      case "cstring":
      case "cstringArray":
        return 8;
      default:
        throw new Error("Unimplemented");
    }
  }
  switch (entry.kind) {
    case "fn":
    case "function":
    case "pointer":
    case "member pointer":
      return (entry as MemberPointerTypeEntry).type.getSizeOf();
    case "class":
    case "class<T>":
    case "enum":
    case "union":
      return entry.cursor.getType()!.getSizeOf();
    case "[N]":
    case "inline class":
    case "inline class<T>":
      return entry.type.getSizeOf();
    case "inline union":
      return Math.max(
        ...entry.fields.map((field) => getSizeOfType(field.type)),
      );
    case "typedef":
      return getSizeOfType(entry.target);
    default:
      throw new Error("Unimplemented");
  }
};

export const createSizedStruct = (
  type: CXType,
): { struct: ("u8" | "u16" | "u32" | "u64")[] } => {
  const size = type.getSizeOf();
  const align = type.getAlignOf();
  if (align !== 1 && align !== 2 && align !== 4 && align !== 8) {
    throw new Error(`Unexpected union alignment '${align}'`);
  }
  const unitString = `u${align * 8}` as "u8" | "u16" | "u32" | "u64";
  if (size === align) {
    return { struct: [unitString] };
  }

  const count = Math.floor(size / align);
  const remainder = size % align;

  if (remainder === 0) {
    return { struct: new Array(count).fill(unitString) };
  } else if (!Number.isInteger(remainder)) {
    throw new Error(`Unexpected union alignment remainder '${remainder}'`);
  }
  return {
    struct: new Array(count).fill(unitString).concat(
      new Array(remainder).fill("u8"),
    ),
  };
};
