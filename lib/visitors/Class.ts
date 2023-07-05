import { CXTypeKind } from "https://deno.land/x/libclang@1.0.0-beta.8/include/typeDefinitions.ts";
import {
  CX_CXXAccessSpecifier,
  CXChildVisitResult,
  CXCursor,
  CXCursorKind,
} from "https://deno.land/x/libclang@1.0.0-beta.8/mod.ts";
import { Context } from "../Context.ts";
import {
  ClassContent,
  ClassEntry,
  InlineClassTemplateTypeEntry,
  Parameter,
  TemplateParameter,
  TypeEntry,
} from "../types.d.ts";
import { getFileNameFromCursor, getNamespacedName } from "../utils.ts";
import { getClassSpecializationByCursor } from "./ClassTemplate.ts";
import { visitFunctionCursor } from "./Function.ts";
import { visitType } from "./Type.ts";

const PLAIN_METHOD_NAME_REGEX = /^[\w_]+$/i;

export const visitClassCursor = (
  context: Context,
  /**
   * Must have kind ClassDecl or StructDecl
   */
  cursor: CXCursor,
  importEntry?: ClassContent,
): ClassEntry => {
  const classEntry = context.findClassByCursor(cursor);

  if (!classEntry) {
    throw new Error(`Could not find class entry for '${cursor.getSpelling()}'`);
  }

  return visitClassEntry(context, classEntry, importEntry);
};

export const visitClassEntry = (
  context: Context,
  classEntry: ClassEntry,
  importEntry?: ClassContent,
): ClassEntry => {
  const visitBasesAndFields = !classEntry.used;

  if (
    !visitBasesAndFields && (!importEntry || !importEntry.constructors &&
        !importEntry.destructors &&
        (!importEntry.methods ||
          Array.isArray(importEntry.methods) &&
            importEntry.methods.length === 0))
  ) {
    // We're not going to visit fields, add constructors, destructors
    // or methods. Thus we do not need to visit children at all.
    return classEntry;
  }

  classEntry.used = true;

  classEntry.cursor.visitChildren((gc) => {
    if (
      gc.kind === CXCursorKind.CXCursor_CXXBaseSpecifier &&
      visitBasesAndFields
    ) {
      try {
        const {
          baseClass,
          isVirtualBase,
        } = visitBaseClass(context, gc, importEntry);
        if (isVirtualBase) {
          classEntry.virtualBases.push(baseClass);
        } else {
          classEntry.bases.push(baseClass);
        }
      } catch (err) {
        const baseError = new Error(
          `Failed to visit base class '${gc.getSpelling()}' of class '${classEntry.name}'`,
        );
        baseError.cause = err;
        throw baseError;
      }
    } else if (gc.kind === CXCursorKind.CXCursor_CXXMethod) {
      try {
        visitMethod(context, classEntry, gc, importEntry);
      } catch (err) {
        const newError = new Error(
          `Failed to visit method '${gc.getSpelling()}' of class '${classEntry.name}'`,
        );
        newError.cause = err;
        throw newError;
      }
    } else if (gc.kind === CXCursorKind.CXCursor_Constructor) {
      try {
        visitConstructor(context, classEntry, gc, importEntry);
      } catch (err) {
        const newError = new Error(
          `Failed to visit constructor '${gc.getSpelling()}' of class '${classEntry.name}'`,
        );
        newError.cause = err;
        throw newError;
      }
    } else if (gc.kind === CXCursorKind.CXCursor_Destructor) {
      try {
        visitDestructor(context, classEntry, gc, importEntry);
      } catch (err) {
        const newError = new Error(
          `Failed to visit destructor '${gc.getSpelling()}' of class '${classEntry.name}'`,
        );
        newError.cause = err;
        throw newError;
      }
    } else if (
      gc.kind === CXCursorKind.CXCursor_FieldDecl && visitBasesAndFields
    ) {
      const type = gc.getType();
      if (!type) {
        throw new Error(
          `Could not get type for class field '${gc.getSpelling()}' of class '${classEntry.name}'`,
        );
      }
      let field: TypeEntry | null;
      try {
        field = visitType(context, type);
      } catch (err) {
        // const access = gc.getCXXAccessSpecifier();
        // if (
        //   access === CX_CXXAccessSpecifier.CX_CXXPrivate ||
        //   access === CX_CXXAccessSpecifier.CX_CXXProtected
        // ) {
        //   // Failure to accurately describe a private or protected field is not an issue.
        //   field = "buffer";
        // } else {
        const newError = new Error(
          `Failed to visit class field '${gc.getSpelling()}' of class '${classEntry.name}'`,
        );
        newError.cause = err;
        throw newError;
        // }
      }
      if (field === null) {
        throw new Error(
          `Found void class field '${gc.getSpelling()}' of class '${classEntry.name}'`,
        );
      }
      if (typeof field === "object" && "used" in field) {
        field.used = true;
      }
      classEntry.fields.push({
        cursor: gc,
        name: gc.getSpelling(),
        type: field,
      });
    }
    return CXChildVisitResult.CXChildVisit_Continue;
  });

  return classEntry;
};

const visitConstructor = (
  context: Context,
  entry: ClassEntry,
  cursor: CXCursor,
  importEntry?: ClassContent,
): void => {
  if (!importEntry || importEntry.constructors === false) {
    // All constructors are ignored.
    return;
  }
  const access = cursor.getCXXAccessSpecifier();
  if (
    access === CX_CXXAccessSpecifier.CX_CXXPrivate ||
    access === CX_CXXAccessSpecifier.CX_CXXProtected ||
    cursor.isFunctionInlined() ||
    typeof importEntry.constructors === "function" &&
      !importEntry.constructors(cursor)
  ) {
    // Do not use private or protected constructors.
    return;
  }

  const manglings = cursor.getCXXManglings();

  if (
    entry.constructors.some((cons) =>
      cons.manglings.every((name, index) => name === manglings[index])
    )
  ) {
    // Attempt to re-enter the same constructor, ignore.
    return;
  }

  // Constructors always take a 0th parameter
  // pointing to the ClassBuffer.
  entry.usedAsBuffer = true;

  const { parameters } = visitFunctionCursor(context, cursor);
  entry.constructors.push({
    parameters,
    cursor,
    manglings,
  });
};

const visitDestructor = (
  context: Context,
  entry: ClassEntry,
  cursor: CXCursor,
  importEntry?: ClassContent,
): void => {
  if (
    !importEntry || importEntry.destructors === false ||
    entry.destructor !== null
  ) {
    // Destructors should not be included.
    return;
  }
  const access = cursor.getCXXAccessSpecifier();
  if (
    access === CX_CXXAccessSpecifier.CX_CXXPrivate ||
    access === CX_CXXAccessSpecifier.CX_CXXProtected ||
    cursor.isFunctionInlined()
  ) {
    // Do not use private or protected destructors
    return;
  }

  visitFunctionCursor(context, cursor);
  entry.destructor = {
    cursor,
    manglings: cursor.getCXXManglings(),
  };
};

const visitMethod = (
  context: Context,
  entry: ClassEntry,
  cursor: CXCursor,
  importEntry?: ClassContent,
): void => {
  if (!importEntry || importEntry.methods === false) {
    // All methods are ignored.
    return;
  }
  const access = cursor.getCXXAccessSpecifier();
  if (
    access === CX_CXXAccessSpecifier.CX_CXXPrivate ||
    access === CX_CXXAccessSpecifier.CX_CXXProtected ||
    cursor.isFunctionInlined()
  ) {
    // Do not use private or protected methods.
    return;
  }

  const mangling = cursor.getMangling();

  if (
    entry.methods.some((method) => method.mangling === mangling)
  ) {
    // Attempt to re-enter the same method, ignore.
    return;
  }

  const methodName = cursor.getSpelling();
  if (
    methodName.includes("operator") &&
    !PLAIN_METHOD_NAME_REGEX.test(methodName)
  ) {
    // Ignore operators.
    return;
  }

  if (
    typeof importEntry.methods === "function" &&
    !importEntry.methods(methodName, cursor)
  ) {
    // Method filter returned false.
    return;
  } else if (
    Array.isArray(importEntry.methods) &&
    !importEntry.methods.some((name) => name === methodName)
  ) {
    // Not requested in methods array.
    return;
  }

  const { parameters, result } = visitFunctionCursor(context, cursor);
  entry.methods.push({
    parameters,
    cursor,
    mangling,
    name: methodName,
    result,
  });
};

export const visitBaseClass = (
  context: Context,
  /**
   * Must have kind CXXBaseSpecifier
   */
  cursor: CXCursor,
  importEntry?: ClassContent,
) => {
  const definition = cursor.getDefinition();
  if (!definition) {
    throw new Error(
      `Could not get definition of base class '${cursor.getSpelling()}'`,
    );
  }
  importEntry = importEntry
    ? {
      // Constructors are always concrete, inheritance
      // doesn't need the parent constructors in API.
      constructors: false,
      // Destructors might be relevant?
      destructors: importEntry.destructors,
      kind: "class",
      methods: importEntry.methods,
      name: definition.getSpelling(),
    }
    : undefined;
  const isVirtualBase = cursor.isVirtualBase();
  const baseClass = context.visitClassLikeByCursor(definition, importEntry);
  if (baseClass.kind === "class<T>") {
    const parameters: (Parameter | TemplateParameter)[] = [];
    const type = cursor.getType()!;
    const targc = type.getNumberOfTemplateArguments();
    for (let i = 0; i < targc; i++) {
      const targType = type.getTemplateArgumentAsType(i)!;
      const kind = targType.kind;
      if (kind === CXTypeKind.CXType_Unexposed) {
        // Template parameter
        const targName = targType.getSpelling();
        parameters.push(
          {
            kind: "<T>",
            name: targName.replace("...", "").replace(" &&", "").replace(
              " &",
              "",
            ),
            isSpread: targName.includes("..."),
            isRef: targName.includes(" &"),
          } satisfies TemplateParameter,
        );
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
        parameters.push({
          comment: null,
          kind: "parameter",
          name: targType.getSpelling(),
          type: visitType(context, targType)!,
        });
      } else {
        throw new Error("Missing template argument kind handling");
      }
    }
    const specialization = getClassSpecializationByCursor(
      baseClass,
      definition.kind === CXCursorKind.CXCursor_StructDecl
        ? definition.getSpecializedTemplate()!
        : definition,
    );
    if (!specialization) {
      throw new Error("Could not find specialization");
    }
    return {
      baseClass: {
        cursor: definition,
        file: getFileNameFromCursor(definition),
        kind: "inline class<T>",
        parameters,
        template: baseClass,
        specialization,
        type,
        name: definition.getSpelling(),
        nsName: getNamespacedName(definition),
      } satisfies InlineClassTemplateTypeEntry,
      isVirtualBase,
    };
  } else {
    return { baseClass, isVirtualBase };
  }
};
