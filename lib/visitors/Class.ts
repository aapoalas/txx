import {
  CX_CXXAccessSpecifier,
  CXChildVisitResult,
  CXCursor,
  CXCursorKind,
} from "https://deno.land/x/libclang@1.0.0-beta.8/mod.ts";
import { Context } from "../Context.ts";
import { ClassContent, ClassEntry, TypeEntry } from "../types.d.ts";
import { visitClassTemplateInstance } from "./ClassTemplate.ts";
import { visitFunction } from "./Function.ts";
import { visitType } from "./Type.ts";
import { visitTypedef } from "./Typedef.ts";
import { getCursorFileLocation } from "../utils.ts";

const PLAIN_METHOD_NAME_REGEX = /^[\w_]+$/i;

export const visitClass = (
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

  const { parameters } = visitFunction(context, cursor);
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

  visitFunction(context, cursor);
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

  const { parameters, result } = visitFunction(context, cursor);
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
  const classEntry = context.findClassByCursor(definition);
  if (classEntry) {
    return {
      baseClass: visitClass(context, classEntry, importEntry),
      isVirtualBase,
    };
  }
  const classTemplateEntry = context.findClassTemplateByCursor(definition);
  if (classTemplateEntry) {
    return {
      baseClass: visitClassTemplateInstance(
        context,
        definition,
      ),
      isVirtualBase,
    };
  }
  const typedefEntry = context.findTypedefByCursor(definition);
  if (typedefEntry) {
    return {
      baseClass: visitTypedef(context, typedefEntry.name),
      isVirtualBase,
    };
  }
  throw new Error(
    `Could not find class with cursor '${definition.getSpelling()}'`,
  );
};
