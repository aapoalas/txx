import {
  CXChildVisitResult,
  CXCursorKind,
  CXType,
  CXTypeKind,
} from "https://deno.land/x/libclang@1.0.0-beta.8/mod.ts";
import { Context } from "../Context.ts";
import {
  ClassField,
  ClassTemplateEntry,
  ConstantArrayTypeEntry,
  FunctionTypeEntry,
  InlineClassTemplateTypeEntry,
  InlineClassTypeEntry,
  InlineUnionTypeEntry,
  Parameter,
  PointerTypeEntry,
  TemplateParameter,
  TypeEntry,
} from "../types.d.ts";
import {
  getFileNameFromCursor,
  getNamespacedName,
  getPlainTypeInfo,
} from "../utils.ts";
import { visitBaseClass } from "./Class.ts";
import { visitClassTemplate } from "./ClassTemplate.ts";
import { visitEnum } from "./Enum.ts";
import { visitTypedef } from "./Typedef.ts";
import { CXVisitorResult } from "https://deno.land/x/libclang@1.0.0-beta.8/include/typeDefinitions.ts";

export const visitType = (context: Context, type: CXType): null | TypeEntry => {
  const kind = type.kind;
  if (kind === CXTypeKind.CXType_Void) {
    return null;
  }
  const name = type.isConstQualifiedType()
    ? type.getSpelling().substring(6)
    : type.getSpelling();
  if (kind === CXTypeKind.CXType_Typedef) {
    return visitTypedef(context, name);
  } else if (kind === CXTypeKind.CXType_Unexposed) {
    const canonicalType = type.getCanonicalType();
    if (canonicalType.kind !== CXTypeKind.CXType_Unexposed) {
      return visitType(context, canonicalType);
    }
    const targc = type.getNumberOfTemplateArguments();
    if (targc > 0) {
      const templateDeclaration = type.getTypeDeclaration();
      if (!templateDeclaration) {
        throw new Error("Unexpected");
      }
      const templateName = templateDeclaration.getSpelling();
      const templateNsName = getNamespacedName(templateDeclaration);
      const templateKind = templateDeclaration.getTemplateKind();
      if (templateKind === CXCursorKind.CXCursor_ClassDecl) {
        const template: ClassTemplateEntry = {
          bases: [],
          constructors: [],
          cursor: templateDeclaration,
          destructor: null,
          fields: [],
          file: getFileNameFromCursor(templateDeclaration),
          kind: "class<T>",
          methods: [],
          name: templateName,
          nsName: templateNsName,
          parameters: [],
          used: true,
          partialSpecializations: [],
          virtualBases: [],
        };
        const parameters: (Parameter | TemplateParameter)[] = [];
        for (let i = 0; i < targc; i++) {
          const targ = type.getTemplateArgumentAsType(i);
          if (!targ) {
            throw new Error(
              "Unexpectedly got no template argument for index",
            );
          }
          template.parameters.push({
            kind: "<T>",
            name: targ.getSpelling(),
            isSpread: targ.getTypeDeclaration()?.getPrettyPrinted()?.includes(
              "...",
            ) ?? false,
          });
          const targType = visitType(context, targ);
          if (!targType) {
            throw new Error("Unexpected null template argument type");
          } else if (
            targType === "buffer" && targ.kind === CXTypeKind.CXType_Unexposed
          ) {
            parameters.push({
              kind: "<T>",
              name: targ.getSpelling(),
              isSpread: targ.getTypeDeclaration()?.getPrettyPrinted()?.includes(
                "...",
              ) ?? false,
            });
          } else {
            parameters.push({
              kind: "parameter",
              comment: null,
              name: targ.getSpelling(),
              type: targType,
            });
          }
        }
        // this.#classTemplates.push(template);
        // this.#useableEntries.push(template);
        return {
          cursor: template.cursor,
          parameters,
          template,
          type,
          kind: "inline class<T>",
          name: template.name,
          nsName: template.nsName,
          file: template.file,
        };
      }
    }
    return "buffer";
  } else if (kind === CXTypeKind.CXType_Elaborated) {
    return visitType(context, type.getNamedType()!);
  } else if (
    kind === CXTypeKind.CXType_Pointer ||
    kind === CXTypeKind.CXType_LValueReference ||
    kind === CXTypeKind.CXType_RValueReference
  ) {
    const pointee = type.getPointeeType();
    if (!pointee) throw new Error('internal error "pointee" is null');
    if (
      pointee.kind === CXTypeKind.CXType_Char_S
    ) {
      return "cstring";
    }
    const result = visitType(context, pointee);
    if (
      pointee.kind === CXTypeKind.CXType_Pointer &&
      result === "cstring"
    ) {
      return "cstringArray";
    } else if (result === null) {
      return "pointer";
    }
    return {
      kind: "pointer",
      pointee: result,
      type,
    } satisfies PointerTypeEntry;
  } else if (
    kind === CXTypeKind.CXType_Enum
  ) {
    return visitEnum(context, name);
  } else if (
    kind === CXTypeKind.CXType_Bool ||
    kind === CXTypeKind.CXType_Char_U ||
    kind === CXTypeKind.CXType_UChar ||
    kind === CXTypeKind.CXType_UShort ||
    kind === CXTypeKind.CXType_UInt ||
    kind === CXTypeKind.CXType_ULong ||
    kind === CXTypeKind.CXType_ULongLong ||
    kind === CXTypeKind.CXType_Char_S ||
    kind === CXTypeKind.CXType_SChar ||
    kind === CXTypeKind.CXType_Short ||
    kind === CXTypeKind.CXType_Int ||
    kind === CXTypeKind.CXType_Long ||
    kind === CXTypeKind.CXType_LongLong ||
    kind === CXTypeKind.CXType_Float ||
    kind === CXTypeKind.CXType_Double ||
    kind === CXTypeKind.CXType_NullPtr
  ) {
    if (kind === CXTypeKind.CXType_NullPtr) {
      throw new Error(type.getSpelling());
    }
    return getPlainTypeInfo(kind, type);
  } else if (kind === CXTypeKind.CXType_Record) {
    const isStruct = type.getCanonicalType().kind === CXTypeKind.CXType_Record;
    if (isStruct) {
      return visitRecordType(context, type);
    } else {
      throw new Error("Non-struct Record?");
    }
  } else if (kind === CXTypeKind.CXType_IncompleteArray) {
    throw new Error("IncompleteArray");
  } else if (kind === CXTypeKind.CXType_ConstantArray) {
    const elemType = type.getArrayElementType();
    if (!elemType) {
      throw new Error("No ConstantArray element type");
    }
    const typeEntry = visitType(context, elemType);
    if (typeEntry === null) {
      throw new Error("ConstantArray element type is void");
    }
    return {
      element: typeEntry,
      kind: "[N]",
      length: type.getArraySize(),
      type,
    } satisfies ConstantArrayTypeEntry;
  } else if (kind === CXTypeKind.CXType_FunctionProto) {
    const parameters: Parameter[] = [];
    const argc = type.getNumberOfArgumentTypes();
    for (let i = 0; i < argc; i++) {
      const argType = type.getArgumentType(i);
      if (!argType) {
        throw new Error("No arg type for index");
      }
      const parameterType = visitType(context, argType);
      if (!parameterType) {
        throw new Error("Failed to visit parameter type");
      }
      parameters.push({
        kind: "parameter",
        comment: null,
        name: `arg_${i}`,
        type: parameterType,
      });
    }
    const resultType = type.getResultType();
    if (!resultType) {
      throw new Error("Failed to get result type");
    }
    const result = visitType(context, resultType);
    return {
      kind: "fn",
      parameters,
      result,
      type,
    } satisfies FunctionTypeEntry;
  } else if (kind === CXTypeKind.CXType_MemberPointer) {
    return {
      type,
      kind: "member pointer",
    };
  }
  throw new Error(`${type.getSpelling()}: ${type.getKindSpelling()}`);
};

export const createInlineTypeEntry = (
  context: Context,
  type: CXType,
): TypeEntry => {
  if (type.kind === CXTypeKind.CXType_Typedef) {
    return createInlineTypeEntry(context, type.getCanonicalType());
  }
  if (type.kind !== CXTypeKind.CXType_Record) {
    const result = visitType(context, type);
    if (result === null) {
      throw new Error("Failed to create type");
    }
  }
  // Drop out the template part from our inline defined template specification.
  if (type.getNumberOfTemplateArguments() <= 0) {
    const structCursor = type.getTypeDeclaration();
    if (!structCursor) {
      throw new Error("Could not get CXCursor of inline struct");
    }
    const isUnion = structCursor.kind === CXCursorKind.CXCursor_UnionDecl;
    const fields: ClassField[] = [];
    structCursor.visitChildren((maybeFieldCursor) => {
      if (maybeFieldCursor.kind === CXCursorKind.CXCursor_FieldDecl) {
        const fieldType = visitType(context, maybeFieldCursor.getType()!);
        if (!fieldType) {
          throw new Error("Field type was void");
        }
        fields.push({
          cursor: maybeFieldCursor,
          name: maybeFieldCursor.getSpelling(),
          type: fieldType,
        });
      }
      return CXChildVisitResult.CXChildVisit_Continue;
    });
    return {
      base: null,
      fields,
      kind: isUnion ? "inline union" : "inline class",
      type,
    };
  }
  const templateCursor = type.getTypeDeclaration();
  if (templateCursor === null) {
    throw new Error("Could not find specialized template declaration cursor");
  }
  const templateName = getNamespacedName(templateCursor);
  const template = visitClassTemplate(context, templateName, templateCursor);
  const targc = type.getNumberOfTemplateArguments();
  const parameters: Parameter[] = [];
  for (let i = 0; i < targc; i++) {
    const targType = type.getTemplateArgumentAsType(i);
    if (!targType) {
      throw new Error("Could not get template argument type");
    }
    const parameterType = visitType(context, targType);
    if (!parameterType) {
      throw new Error("void parameter type");
    }
    parameters.push({
      kind: "parameter",
      comment: null,
      name: "",
      type: parameterType,
    });
  }
  return {
    cursor: template.cursor,
    parameters,
    template,
    kind: "inline class<T>",
    name: template.name,
    nsName: template.nsName,
    type,
    file: template.file,
  };
};

const visitRecordType = (
  context: Context,
  type: CXType,
): InlineClassTypeEntry => {
  if (
    type.getSizeOf() === -2 && type.getNumberOfTemplateArguments() === -1
  ) {
    // This class or struct is only forward-declared in our headers:
    // This is usually not really an issue and we shouldn't care about it.
    // It's just an opaque type. If this type needs to be used then we have
    // an issue, but most likely this is just used as an opaque pointer in
    // which case there is no issue.
    return {
      base: null,
      fields: [],
      type,
      kind: "inline class",
    };
  }

  const fields: ClassField[] = [];
  type.visitFields((cursor) => {
    const fieldType = cursor.getType();
    if (!fieldType) {
      throw new Error("Failed to get field type");
    }
    const found = context.findTypedefByType(fieldType);
    let type: null | TypeEntry;
    if (found) {
      type = visitType(context, fieldType);
    } else {
      type = createInlineTypeEntry(context, fieldType);
    }
    if (!type) {
      throw new Error("Failed to visit field type");
    }
    fields.push({
      cursor,
      name: cursor.getSpelling(),
      type,
    });
    return CXVisitorResult.CXVisit_Continue;
  });

  const declaration = type.getTypeDeclaration();
  return {
    base: declaration && declaration.getSpecializedTemplate()
      ? visitBaseClass(
        context,
        declaration.getSpecializedTemplate()!,
      ).baseClass
      : null,
    fields,
    kind: "inline class",
    type,
  };
};
