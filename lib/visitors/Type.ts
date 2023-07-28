import {
  CXChildVisitResult,
  CXCursorKind,
  CXType,
  CXTypeKind,
} from "https://deno.land/x/libclang@1.0.0-beta.8/mod.ts";
import { Context } from "../Context.ts";
import {
  ClassField,
  ConstantArrayTypeEntry,
  FunctionTypeEntry,
  InlineClassTemplateTypeEntry,
  InlineClassTypeEntry,
  Parameter,
  PointerTypeEntry,
  TemplateParameter,
  TypeEntry
} from "../types.d.ts";
import {
  getFileNameFromCursor,
  getNamespacedName,
  getPlainTypeInfo,
  isInlineTemplateStruct,
  isPassableByValue,
  isPointer,
  isStruct
} from "../utils.ts";
import { markClassUsedAsBufferOrPointer } from "./Class.ts";
import {
  getClassSpecializationByCursor,
  markTemplateInstanceUsedAsBufferOrPointer,
  visitClassTemplateCursor,
} from "./ClassTemplate.ts";
import { visitEnum } from "./Enum.ts";
import { visitTypedefEntry } from "./Typedef.ts";
import { visitUnionCursor } from "./Union.ts";

export const visitType = (context: Context, type: CXType): null | TypeEntry => {
  const kind = type.kind;
  if (kind === CXTypeKind.CXType_Void) {
    return null;
  }
  const name = type.isConstQualifiedType()
    ? type.getSpelling().substring(6)
    : type.getSpelling();
  if (kind === CXTypeKind.CXType_Typedef) {
    const declaration = type.getTypeDeclaration();
    const canonicalType = type.getCanonicalType();
    if (!declaration) {
      if (type.equals(canonicalType)) {
        throw new Error(
          "Type equals canonical type and declaration cannot be found",
        );
      }
      return visitType(context, canonicalType);
    }
    const found = context.findTypedefByCursor(declaration);
    if (found) {
      return visitTypedefEntry(context, type.getTypeDeclaration()!);
    }
    const underlyingType = declaration.getTypedefDeclarationOfUnderlyingType();
    if (!underlyingType) {
      if (type.equals(canonicalType)) {
        throw new Error(
          "Type equals canonical type and underlying type cannot be found",
        );
      }
      return visitType(context, canonicalType);
    }
    return visitType(context, underlyingType);
  } else if (kind === CXTypeKind.CXType_Unexposed) {
    return visitUnexposedType(context, type);
  } else if (kind === CXTypeKind.CXType_Elaborated) {
    return visitElaboratedType(context, type);
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
    return visitRecordType(context, type);
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
    // Function type definitions are presumed to always be callbacks.
    // Otherwise they don't make too much sense.
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

      if (isStruct(parameterType)) {
        // Struct type as a callback parameter: This is either pass-by-value or pass-by-ref.
        // If it is pass-by-value then it comes to Deno as a Uint8Array from which it
        // can be transformed into ClassBuffer without allocating through
        // `new ClassBuffer(param.buffer)`.
        // If it is pass-by-ref then it comes to Deno as a `Deno.PointerObject`.
        markClassUsedAsBufferOrPointer(
          parameterType,
          isPassableByValue(parameterType),
        );
      } else if (
        isInlineTemplateStruct(parameterType)
      ) {
        // Same goes for template instances.
        if (!parameterType.specialization) {
          parameterType.specialization = parameterType.template
            .defaultSpecialization!;
        }
        markTemplateInstanceUsedAsBufferOrPointer(
          parameterType,
          isPassableByValue(parameterType),
        );
      } else if (isPointer(parameterType)) {
        // Pointers to struct types come to Deno as `Deno.PointerObject`.
        if (isStruct(parameterType.pointee)) {
          markClassUsedAsBufferOrPointer(parameterType.pointee, false);
        } else if (isInlineTemplateStruct(parameterType.pointee)) {
          if (!parameterType.pointee.specialization) {
            parameterType.pointee.specialization = parameterType.pointee
              .template.defaultSpecialization!;
          }
          markTemplateInstanceUsedAsBufferOrPointer(
            parameterType.pointee,
            false,
          );
        }
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

    if (isStruct(result)) {
      // By-value struct returns as a Uint8Array,
      // by-ref struct takes an extra Uint8Array parameter.
      // Either way, the struct ends up as a buffer.
      markClassUsedAsBufferOrPointer(result, true);
    } else if (isInlineTemplateStruct(result)) {
      // Same thing as above: One way or another the template
      // instance struct ends up as a buffer.
      if (!result.specialization) {
        result.specialization = result.template.defaultSpecialization!;
      }
      markTemplateInstanceUsedAsBufferOrPointer(result, true);
    } else if (isPointer(result)) {
      if (isStruct(result.pointee)) {
        markClassUsedAsBufferOrPointer(result.pointee, false);
      } else if (isInlineTemplateStruct(result.pointee)) {
        if (!result.pointee.specialization) {
          result.pointee.specialization = result.pointee.template
            .defaultSpecialization!;
        }
        markTemplateInstanceUsedAsBufferOrPointer(result.pointee, false);
      }
    }

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
    return result;
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
  const template = visitClassTemplateCursor(
    context,
    templateCursor,
  );
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
    specialization: getClassSpecializationByCursor(template, templateCursor)!,
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
) => {
  const size = type.getSizeOf();
  const targc = type.getNumberOfTemplateArguments();
  if (
    size === -2 && targc === -1
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
    } satisfies InlineClassTypeEntry;
  }

  const declaration = type.getTypeDeclaration();

  if (!declaration) {
    throw new Error(`No type declaration ${type.getSpelling()}`);
  }

  if (targc === 0) {
    throw new Error("ASD");
  }

  const parameters: Parameter[] = [];
  for (let i = 0; i < targc; i++) {
    const targType = visitType(context, type.getTemplateArgumentAsType(i)!);
    if (targType === null) {
      throw new Error("ASD");
    }
    parameters.push({
      comment: null,
      kind: "parameter",
      name: `targ_${i}`,
      type: targType,
    });
  }

  if (!declaration.getSpelling()) {
    // Anonymous declarations are not saved.
    return createInlineTypeEntry(context, type);
  }

  if (
    declaration.kind === CXCursorKind.CXCursor_ClassDecl ||
    declaration.kind === CXCursorKind.CXCursor_StructDecl
  ) {
    const result = context.visitClassLikeByCursor(declaration);
    if (result.kind === "class") {
      return result;
    } else if (result.kind === "typedef") {
      return result;
    } else if (result.kind === "class<T>") {
      return {
        cursor: declaration,
        file: getFileNameFromCursor(declaration),
        kind: "inline class<T>",
        parameters,
        template: result,
        specialization: getClassSpecializationByCursor(
          result,
          declaration.getSpecializedTemplate()!,
        ) || null,
        type,
        name: declaration.getSpelling(),
        nsName: getNamespacedName(declaration),
      } satisfies InlineClassTemplateTypeEntry;
    } else {
      throw new Error("Unexpected result from visitClassLikeByCursor");
    }
  } else if (declaration.kind === CXCursorKind.CXCursor_TypedefDecl) {
    throw new Error(`Unexpected TypedefDecl '${type.getSpelling()}'`);
    // const typedefEntry = context.findTypedefByCursor(declaration);
  } else if (
    declaration.kind === CXCursorKind.CXCursor_ClassTemplate ||
    declaration.kind ===
      CXCursorKind.CXCursor_ClassTemplatePartialSpecialization
  ) {
    return visitClassTemplateCursor(context, declaration);
  } else if (declaration.kind === CXCursorKind.CXCursor_UnionDecl) {
    return visitUnionCursor(context, declaration);
  }

  throw new Error(declaration.getKindSpelling());
  // return {
  //   base: declaration.getSpecializedTemplate()
  //     ? visitBaseClass(
  //       context,
  //       declaration.getSpecializedTemplate()!,
  //     ).baseClass
  //     : null,
  //   fields: [],
  //   kind: "inline class",
  //   type,
  // } satisfies InlineClassTypeEntry;
};

const visitElaboratedType = (
  context: Context,
  /**
   * Must by of kind Elaborated
   */
  type: CXType,
) => {
  const elaborated = type.getNamedType();

  if (!elaborated) {
    throw new Error(
      `Unexpectedly could not get named type of elaborated type '${type.getSpelling()}'`,
    );
  }

  if (elaborated.kind !== CXTypeKind.CXType_Unexposed) {
    // Elaborated type points to something we can analyze normally, continue with that.
    return visitType(context, elaborated);
  }

  return visitUnexposedType(context, elaborated);
};

const visitUnexposedType = (context: Context, type: CXType) => {
  const canonicalType = type.getCanonicalType();

  if (canonicalType.kind !== CXTypeKind.CXType_Unexposed) {
    return visitType(context, canonicalType);
  }

  // Unexposed types are often some kind of parameters.
  const name = type.isConstQualifiedType()
    ? type.getSpelling().substring(6)
    : type.getSpelling();
  const targc = type.getNumberOfTemplateArguments();

  if (targc < 0) {
    if (name.startsWith("type-parameter-")) {
      const isSpread = name.endsWith("...");
      let mutName = isSpread ? name.substring(0, name.length - 3) : name;
      const isRvalueRef = mutName.endsWith(" &&");
      const isLvalueRef = mutName.endsWith(" &");
      if (isRvalueRef) {
        mutName = mutName.substring(0, mutName.length - 3);
      } else if (isLvalueRef) {
        mutName = mutName.substring(0, mutName.length - 2);
      }
      return {
        name: mutName,
        kind: "<T>",
        isSpread,
        isRef: isLvalueRef || isRvalueRef,
      } satisfies TemplateParameter;
    }
    const canonicalName = canonicalType.getSpelling();
    if (canonicalName.startsWith("type-parameter-")) {
      const isSpread = canonicalName.endsWith("...");
      let mutName = isSpread
        ? canonicalName.substring(0, canonicalName.length - 3)
        : canonicalName;
      const isRvalueRef = mutName.endsWith(" &&");
      const isLvalueRef = mutName.endsWith(" &");
      if (isRvalueRef) {
        mutName = mutName.substring(0, mutName.length - 3);
      } else if (isLvalueRef) {
        mutName = mutName.substring(0, mutName.length - 2);
      }
      return {
        name: mutName,
        kind: "<T>",
        isSpread,
        isRef: isLvalueRef || isRvalueRef,
      } satisfies TemplateParameter;
    }

    throw new Error(
      "Unexpected: Found unexposed non-template type that was is not a type parameter",
    );
  }

  const templateDeclaration = type.getTypeDeclaration();
  if (!templateDeclaration) {
    throw new Error(
      "Could not find type declaration for elaborated template type",
    );
  }

  if (templateDeclaration.kind === CXCursorKind.CXCursor_ClassTemplate) {
    const classTemplateEntry = visitClassTemplateCursor(
      context,
      templateDeclaration,
    );
    const partialSpecialization = getClassSpecializationByCursor(
      classTemplateEntry,
      templateDeclaration,
    );

    if (!partialSpecialization) {
      throw new Error("Could not determine partial specialization");
    }

    const parameters: (Parameter | TemplateParameter)[] = [];

    for (let i = 0; i < targc; i++) {
      const targ = type.getTemplateArgumentAsType(i);
      if (!targ) {
        throw new Error(
          "Unexpectedly got no template argument for index",
        );
      }
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
          isRef: targ.getTypeDeclaration()?.getPrettyPrinted()?.includes(
            " &",
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

    return {
      cursor: partialSpecialization?.cursor || classTemplateEntry.cursor,
      file: getFileNameFromCursor(
        partialSpecialization?.cursor || classTemplateEntry.cursor,
      ),
      kind: "inline class<T>",
      parameters,
      specialization: partialSpecialization,
      template: classTemplateEntry,
      type,
      name: partialSpecialization?.name || classTemplateEntry.name,
      nsName: classTemplateEntry.nsName,
    } satisfies InlineClassTemplateTypeEntry;
  }
  throw new Error("ASD");
};
