import {
  CXChildVisitResult,
  CXCursor,
  CXCursorKind,
  CXType,
} from "https://deno.land/x/libclang@1.0.0-beta.8/mod.ts";
import { Context } from "../Context.ts";
import {
  ClassTemplateEntry,
  InlineClassTemplateTypeEntry,
  TemplateParameter,
  TypeEntry,
} from "../types.d.ts";
import { getNamespacedName } from "../utils.ts";
import { visitBaseClass } from "./Class.ts";
import { createInlineTypeEntry, visitType } from "./Type.ts";

export const visitClassTemplate = (
  context: Context,
  nsName: string,
  templateCursor?: CXCursor,
): ClassTemplateEntry => {
  const classTemplateEntry = templateCursor
    ? context.findClassTemplateByCursor(templateCursor)
    : context.findClassTemplateByName(nsName);
  let foundPartialSpecialization = classTemplateEntry && templateCursor
    ? classTemplateEntry.partialSpecializations.find((entry) =>
      entry.cursor.equals(templateCursor)
    )
    : undefined;
  if (!classTemplateEntry) {
    throw new Error(`Could not find class template '${nsName}'`);
  }

  if (classTemplateEntry.name === "function" && !foundPartialSpecialization) {
    console.trace();
  }

  if (
    !foundPartialSpecialization &&
    classTemplateEntry.partialSpecializations.length === 1
  ) {
    foundPartialSpecialization = classTemplateEntry.partialSpecializations[0];
  }

  if (classTemplateEntry.partialSpecializations.length > 1) {
    for (const spec of classTemplateEntry.partialSpecializations) {
      if (spec.parameters.length || spec.bases.length || spec.fields.length) {
        // Already populated
        continue;
      }

      spec.cursor.visitChildren((gc) => {
        if (gc.kind === CXCursorKind.CXCursor_TemplateTypeParameter) {
          spec.parameters.push({
            kind: "<T>",
            name: gc.getSpelling(),
            isSpread: gc.getPrettyPrinted().includes("..."),
          });
        } else if (gc.kind === CXCursorKind.CXCursor_CXXBaseSpecifier) {
          const { baseClass, isVirtualBase } = visitBaseClass(context, gc);
          if (isVirtualBase) {
            spec.virtualBases.push(baseClass);
          } else {
            spec.bases.push(baseClass);
          }
        }
        return 1;
      });
    }
  }

  const partialSpecialization = foundPartialSpecialization;

  const visitBasesAndFields = !classTemplateEntry.used;
  const visitPartialSpecializationFieldsAndBases = partialSpecialization
    ? !partialSpecialization.used
    : false;

  if (
    !visitBasesAndFields && !visitPartialSpecializationFieldsAndBases
  ) {
    // We're not going to visit fields, add constructors, destructors
    // or methods. Thus we do not need to visit children at all.
    return classTemplateEntry;
  }

  classTemplateEntry.used = true;

  classTemplateEntry.cursor.visitChildren(
    (gc: CXCursor): CXChildVisitResult => {
      if (
        gc.kind === CXCursorKind.CXCursor_CXXBaseSpecifier &&
        visitBasesAndFields
      ) {
        try {
          const { baseClass, isVirtualBase } = visitBaseClass(context, gc);
          if (isVirtualBase) {
            classTemplateEntry.virtualBases.push(baseClass);
          } else {
            classTemplateEntry.bases.push(baseClass);
          }
        } catch (err) {
          const baseError = new Error(
            `Failed to visit base class '${gc.getSpelling()}' of class template '${classTemplateEntry.name}'`,
          );
          baseError.cause = err;
          throw baseError;
        }
      } else if (gc.kind === CXCursorKind.CXCursor_CXXMethod) {
        // try {
        //   this.#visitMethod(classEntry, importEntry, gc);
        // } catch (err) {
        //   const newError = new Error(
        //     `Failed to visit method '${gc.getSpelling()}' of class '${classEntry.name}'`,
        //   );
        //   newError.cause = err;
        //   throw newError;
        // }
      } else if (gc.kind === CXCursorKind.CXCursor_Constructor) {
        // try {
        //   this.#visitConstructor(classEntry, importEntry, gc);
        // } catch (err) {
        //   const newError = new Error(
        //     `Failed to visit constructor '${gc.getSpelling()}' of class '${classEntry.name}'`,
        //   );
        //   newError.cause = err;
        //   throw newError;
        // }
      } else if (gc.kind === CXCursorKind.CXCursor_Destructor) {
        // try {
        //   this.#visitDestructor(classEntry, importEntry, gc);
        // } catch (err) {
        //   const newError = new Error(
        //     `Failed to visit destructor '${gc.getSpelling()}' of class '${classEntry.name}'`,
        //   );
        //   newError.cause = err;
        //   throw newError;
        // }
      } else if (
        gc.kind === CXCursorKind.CXCursor_FieldDecl && visitBasesAndFields
      ) {
        const type = gc.getType();
        if (!type) {
          throw new Error(
            `Could not get type for class field '${gc.getSpelling()}' of class '${classTemplateEntry.name}'`,
          );
        }
        let field: TypeEntry | null;
        try {
          field = visitType(context, type);
        } catch (err) {
          //   const access = gc.getCXXAccessSpecifier();
          //   if (
          //     access === CX_CXXAccessSpecifier.CX_CXXPrivate ||
          //     access === CX_CXXAccessSpecifier.CX_CXXProtected
          //   ) {
          //     // Failure to accurately describe a private or protected field is not an issue.
          //     field = "buffer";
          //   } else {
          const newError = new Error(
            `Failed to visit class field '${gc.getSpelling()}' of class '${classTemplateEntry.name}'`,
          );
          newError.cause = err;
          throw newError;
          //   }
        }
        if (field === null) {
          throw new Error(
            `Found void class field '${gc.getSpelling()}' of class '${classTemplateEntry.name}'`,
          );
        }
        if (typeof field === "object" && "used" in field) {
          field.used = true;
        }
        classTemplateEntry.fields.push({
          cursor: gc,
          name: gc.getSpelling(),
          type: field,
        });
      } else if (
        gc.kind === CXCursorKind.CXCursor_TemplateTypeParameter &&
        visitBasesAndFields
      ) {
        classTemplateEntry.parameters.push({
          kind: "<T>",
          name: gc.getSpelling(),
        });
      }
      return CXChildVisitResult.CXChildVisit_Continue;
    },
  );

  if (!partialSpecialization) {
    return classTemplateEntry;
  }

  partialSpecialization.used = true;

  partialSpecialization.cursor.visitChildren((gc) => {
    if (
      gc.kind === CXCursorKind.CXCursor_CXXBaseSpecifier &&
      visitPartialSpecializationFieldsAndBases
    ) {
      try {
        const { isVirtualBase, baseClass } = visitBaseClass(context, gc);
        if (isVirtualBase) {
          partialSpecialization.virtualBases.push(baseClass);
        } else {
          partialSpecialization.virtualBases.push(baseClass);
        }
      } catch (err) {
        const baseError = new Error(
          `Failed to visit base class '${gc.getSpelling()}' of class '${classTemplateEntry.name}'`,
        );
        baseError.cause = err;
        throw baseError;
      }
    } else if (
      gc.kind === CXCursorKind.CXCursor_FieldDecl &&
      visitPartialSpecializationFieldsAndBases
    ) {
      const type = gc.getType();
      if (!type) {
        throw new Error(
          `Could not get type for class field '${gc.getSpelling()}' of class '${classTemplateEntry.name}'`,
        );
      }
      let field: TypeEntry | null;
      try {
        const found = context.findTypedefByType(type);
        if (found) {
          field = visitType(context, type);
        } else {
          field = createInlineTypeEntry(context, type);
        }
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
          `Failed to visit class field '${gc.getSpelling()}' of class '${classTemplateEntry.name}'`,
        );
        newError.cause = err;
        throw newError;
        // }
      }
      if (field === null) {
        throw new Error(
          `Found void class field '${gc.getSpelling()}' of class '${classTemplateEntry.name}'`,
        );
      }
      if (typeof field === "object" && "used" in field) {
        field.used = true;
      }
      partialSpecialization.fields.push({
        cursor: gc,
        name: gc.getSpelling(),
        type: field,
      });
    } else if (
      gc.kind === CXCursorKind.CXCursor_TemplateTypeParameter &&
      visitPartialSpecializationFieldsAndBases
    ) {
      partialSpecialization.parameters.push({
        kind: "<T>",
        name: gc.getSpelling(),
        isSpread: gc.getPrettyPrinted().includes("typename ..."),
      });
    }
    return CXChildVisitResult.CXChildVisit_Continue;
  });
  return classTemplateEntry;
};

export const visitClassTemplateInstance = (
  context: Context,
  instance: CXCursor,
): InlineClassTemplateTypeEntry => {
  const ttype = instance.getType();
  if (!ttype) {
    console.log(
      instance.getSpelling(),
      instance.getKindSpelling(),
      instance.getNumberOfTemplateArguments(),
    );
  }
  const appliedParameters: TemplateParameter[] = [];
  if (ttype) {
    const ttargc = ttype.getNumberOfTemplateArguments()!;
    for (let i = 0; i < ttargc; i++) {
      const ttarg = ttype.getTemplateArgumentAsType(i);
      if (!ttarg) {
        throw new Error("Could not get template argument type");
      }
      appliedParameters.push({
        kind: "<T>",
        name: ttarg.getSpelling(),
        isSpread: ttarg.getTypeDeclaration()?.getPrettyPrinted()
          .includes("typename ...") ?? false,
      });
    }
  }
  if (
    instance.kind ===
      CXCursorKind.CXCursor_ClassTemplatePartialSpecialization
  ) {
    const specialized = instance.getSpecializedTemplate();
    if (!specialized) {
      throw new Error("Unexpected");
    }
    const classTemplateEntry = context.findClassTemplateByCursor(specialized);
    if (!classTemplateEntry) {
      throw new Error("Unexpected");
    }
    const found = visitClassTemplate(
      context,
      classTemplateEntry.nsName,
      instance,
    );
    return {
      cursor: found.cursor,
      file: found.file,
      kind: "inline class<T>",
      name: found.name,
      nsName: found.nsName,
      parameters: appliedParameters,
      template: found,
      type: ttype,
    };
  } else if (
    instance.kind === CXCursorKind.CXCursor_ClassTemplate
  ) {
    const found = visitClassTemplate(
      context,
      getNamespacedName(instance),
      instance,
    );
    return {
      cursor: found.cursor,
      file: found.file,
      kind: "inline class<T>",
      name: found.name,
      nsName: found.nsName,
      parameters: appliedParameters,
      template: found,
      type: ttype,
    };
  } else {
    throw new Error("Wrooong");
  }
};
