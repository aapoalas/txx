import {
  CXChildVisitResult,
  CXCursor,
  CXCursorKind,
} from "https://deno.land/x/libclang@1.0.0-beta.8/mod.ts";
import { Context } from "../Context.ts";
import {
  ClassTemplateEntry,
  ClassTemplatePartialSpecialization,
  InlineClassTemplateTypeEntry,
  TemplateParameter,
  TypeEntry,
} from "../types.d.ts";
import { getNamespacedName } from "../utils.ts";
import { visitBaseClass } from "./Class.ts";
import { createInlineTypeEntry, visitType } from "./Type.ts";

export const visitClassTemplateCursor = (
  context: Context,
  cursor: CXCursor,
): ClassTemplateEntry => {
  const classTemplateEntry = context.findClassTemplateByCursor(cursor);
  const foundPartialSpecialization = classTemplateEntry && cursor
    ? classTemplateEntry.partialSpecializations.find((entry) =>
      entry.cursor.equals(cursor)
    )
    : undefined;
  if (!classTemplateEntry) {
    throw new Error(
      `Could not find class template '${getNamespacedName(cursor)}'`,
    );
  }

  return visitClassTemplateEntry(
    context,
    classTemplateEntry,
    foundPartialSpecialization,
  );
};

export const getClassSpecializationByCursor = (
  entry: ClassTemplateEntry,
  cursor: CXCursor,
) => {
  if (entry.defaultSpecialization.cursor.equals(cursor)) {
    return entry.defaultSpecialization;
  }
  const specialization = entry.partialSpecializations.find((spec) =>
    spec.cursor.equals(cursor)
  );
  if (!specialization) {
    throw new Error("Could not find matching specialization");
  }
  return specialization;
};

export const visitClassTemplateEntry = (
  context: Context,
  classTemplateEntry: ClassTemplateEntry,
  partialSpecialization?: ClassTemplatePartialSpecialization,
): ClassTemplateEntry => {
  if (
    !partialSpecialization &&
    classTemplateEntry.partialSpecializations.length === 1
  ) {
    partialSpecialization = classTemplateEntry.partialSpecializations[0];
  }

  const doVisit = !classTemplateEntry.used;

  if (partialSpecialization) {
    partialSpecialization.used = true;
  }

  if (
    !doVisit
  ) {
    return classTemplateEntry;
  }

  classTemplateEntry.used = true;

  const defaultSpecialization = classTemplateEntry.defaultSpecialization;

  classTemplateEntry.cursor.visitChildren(
    (gc: CXCursor): CXChildVisitResult => {
      if (
        gc.kind === CXCursorKind.CXCursor_CXXBaseSpecifier
      ) {
        try {
          const { baseClass, isVirtualBase } = visitBaseClass(context, gc);
          if (isVirtualBase) {
            defaultSpecialization.virtualBases.push(baseClass);
          } else {
            defaultSpecialization.bases.push(baseClass);
          }
        } catch (err) {
          const baseError = new Error(
            `Failed to visit base class '${gc.getSpelling()}' of class template '${classTemplateEntry.name}' default specialization`,
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
        gc.kind === CXCursorKind.CXCursor_FieldDecl
      ) {
        const type = gc.getType();
        if (!type) {
          throw new Error(
            `Could not get type for class field '${gc.getSpelling()}' of class '${classTemplateEntry.name}' defaultSpecialization`,
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
            `Failed to visit class field '${gc.getSpelling()}' of class '${classTemplateEntry.name}' defaultSpecialization`,
          );
          newError.cause = err;
          throw newError;
          //   }
        }
        if (field === null) {
          throw new Error(
            `Found void class field '${gc.getSpelling()}' of class '${classTemplateEntry.name}' default specialization`,
          );
        }
        if (typeof field === "object" && "used" in field) {
          field.used = true;
        }
        defaultSpecialization.fields.push({
          cursor: gc,
          name: gc.getSpelling(),
          type: field,
        });
      } else if (
        gc.kind === CXCursorKind.CXCursor_TemplateTypeParameter
      ) {
        defaultSpecialization.parameters.push({
          kind: "<T>",
          name: gc.getSpelling().replace("...", "").replace(" &&", "").replace(
            " &",
            "",
          ),
          isSpread: gc.getSpelling().includes("..."),
          isRef: gc.getSpelling().includes(" &"),
        });
      } else if (
        gc.kind === CXCursorKind.CXCursor_TemplateTemplateParameter
      ) {
        throw new Error(
          `Encountered template template parameter '${gc.getSpelling()} in class template '${classTemplateEntry.nsName}''`,
        );
      }
      return CXChildVisitResult.CXChildVisit_Continue;
    },
  );

  // Default specialization and class template itself take the same parameters.
  classTemplateEntry.parameters.push(...defaultSpecialization.parameters);

  classTemplateEntry.partialSpecializations.forEach((spec) => {
    spec.cursor.visitChildren((gc) => {
      if (
        gc.kind === CXCursorKind.CXCursor_CXXBaseSpecifier
      ) {
        try {
          const { isVirtualBase, baseClass } = visitBaseClass(context, gc);
          if (isVirtualBase) {
            spec.virtualBases.push(baseClass);
          } else {
            spec.bases.push(baseClass);
          }
        } catch (err) {
          const baseError = new Error(
            `Failed to visit base class '${gc.getSpelling()}' of class '${classTemplateEntry.name}'`,
          );
          baseError.cause = err;
          throw baseError;
        }
      } else if (
        gc.kind === CXCursorKind.CXCursor_FieldDecl
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
        spec.fields.push({
          cursor: gc,
          name: gc.getSpelling(),
          type: field,
        });
      } else if (
        gc.kind === CXCursorKind.CXCursor_TemplateTypeParameter
      ) {
        spec.parameters.push({
          kind: "<T>",
          name: gc.getSpelling(),
          isSpread: gc.getPrettyPrinted().includes("typename ..."),
          isRef: gc.getPrettyPrinted().includes(" &"),
        });
      } else if (
        gc.kind === CXCursorKind.CXCursor_TemplateTemplateParameter
      ) {
        throw new Error(
          `Encountered template template parameter '${gc.getSpelling()} in class template '${classTemplateEntry.nsName}''`,
        );
      }
      return CXChildVisitResult.CXChildVisit_Continue;
    });

    const specType = spec.cursor.getType()!;
    const targc = specType.getNumberOfTemplateArguments();
    for (let i = 0; i < targc; i++) {
      const targType = visitType(
        context,
        specType.getTemplateArgumentAsType(i)!,
      );
      spec.application.push(targType!);
    }
  });

  return classTemplateEntry;
};

export const visitClassTemplateInstance = (
  context: Context,
  instance: CXCursor,
): InlineClassTemplateTypeEntry => {
  const ttype = instance.getType();
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
        isRef: ttarg.getTypeDeclaration()?.getPrettyPrinted()
          .includes(" &") ?? false,
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
    const found = visitClassTemplateCursor(
      context,
      instance,
    );
    if (ttype === null) {
      throw new Error(
        `${classTemplateEntry.nsName} instance had a null type value for ${instance.getSpelling()}
      `,
      );
    }
    return {
      cursor: found.cursor,
      file: found.file,
      kind: "inline class<T>",
      name: found.name,
      nsName: found.nsName,
      parameters: appliedParameters,
      specialization: getClassSpecializationByCursor(found, instance),
      template: found,
      type: ttype,
    };
  } else if (
    instance.kind === CXCursorKind.CXCursor_ClassTemplate
  ) {
    const found = visitClassTemplateCursor(
      context,
      instance,
    );
    if (ttype === null) {
      throw new Error(
        `${found.nsName} instance had a null type value for ${instance.getSpelling()}
      `,
      );
    }
    return {
      cursor: found.cursor,
      file: found.file,
      kind: "inline class<T>",
      name: found.name,
      nsName: found.nsName,
      parameters: appliedParameters,
      specialization: getClassSpecializationByCursor(found, instance),
      template: found,
      type: ttype,
    };
  } else {
    throw new Error("Wrooong");
  }
};
