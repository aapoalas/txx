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
import { markClassUsedAsBufferOrPointer, visitBaseClass } from "./Class.ts";
import { createInlineTypeEntry, visitType } from "./Type.ts";
import { markTypedefUsedAsBufferOrPointer } from "./Typedef.ts";

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
  const specialization = entry.partialSpecializations.find((spec) =>
    spec.cursor.equals(cursor)
  );
  if (specialization) {
    return specialization;
  }
  if (entry.cursor.equals(cursor) && entry.defaultSpecialization) {
    return entry.defaultSpecialization;
  } else if (
    entry.defaultSpecialization &&
    entry.defaultSpecialization.cursor.equals(cursor)
  ) {
    return entry.defaultSpecialization;
  }
  if (!specialization) {
    if (
      entry.cursor.isDefinition() && entry.partialSpecializations.length === 0
    ) {
      // Only default specialization is available: It must be what we should match.
      return entry.defaultSpecialization ?? undefined;
    } else if (
      !entry.cursor.isDefinition() && entry.partialSpecializations.length === 1
    ) {
      // Only one partial specialization is available: We should probably use it.
      return entry.partialSpecializations[0];
    } else if (
      !entry.cursor.isDefinition() && entry.partialSpecializations.length === 0
    ) {
      // No definitions available. Ignore.
      return;
    } else if (entry.cursor.equals(cursor)) {
      // We match the default specialization which doesn't exist.
      return entry.defaultSpecialization ?? undefined;
    }
    throw new Error("Could not find matching specialization");
  }
  return specialization;
};

export const visitClassTemplateEntry = (
  context: Context,
  classTemplateEntry: ClassTemplateEntry,
  partialSpecialization?: ClassTemplatePartialSpecialization,
): ClassTemplateEntry => {
  if (!classTemplateEntry.used) {
    classTemplateEntry.used = true;
    classTemplateEntry.cursor.visitChildren((gc) => {
      if (
        gc.kind === CXCursorKind.CXCursor_TemplateTypeParameter
      ) {
        classTemplateEntry.parameters.push({
          kind: "<T>",
          name: gc.getSpelling().replace("...", "").replace(" &&", "")
            .replace(
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
    });
  }

  if (!partialSpecialization) {
    visitClassTemplateDefaultSpecialization(context, classTemplateEntry);
  } else {
    visitClassTemplateSpecialization(
      context,
      classTemplateEntry,
      partialSpecialization,
    );
  }

  return classTemplateEntry;
};

const visitClassTemplateDefaultSpecialization = (
  context: Context,
  classTemplateEntry: ClassTemplateEntry,
) => {
  if (
    classTemplateEntry.defaultSpecialization ||
    !classTemplateEntry.cursor.isDefinition()
  ) {
    return;
  }

  const defaultSpecialization = createDefaultSpecialization(
    classTemplateEntry.name,
    classTemplateEntry.cursor,
  );
  classTemplateEntry.defaultSpecialization = defaultSpecialization;
  defaultSpecialization.used = true;

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
          name: gc.getSpelling().replace("...", "").replace(" &&", "")
            .replace(
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
};

const visitClassTemplateSpecialization = (
  context: Context,
  classTemplateEntry: ClassTemplateEntry,
  spec: ClassTemplatePartialSpecialization,
) => {
  if (spec.used) {
    return;
  }
  spec.used = true;
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
      specialization: getClassSpecializationByCursor(found, instance)!,
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
      specialization: getClassSpecializationByCursor(found, instance)!,
      template: found,
      type: ttype,
    };
  } else {
    throw new Error("Wrooong");
  }
};

const createDefaultSpecialization = (
  name: string,
  cursor: CXCursor,
): ClassTemplatePartialSpecialization => ({
  name,
  application: [],
  bases: [],
  constructors: [],
  cursor,
  destructor: null,
  fields: [],
  kind: "partial class<T>",
  methods: [],
  parameters: [],
  used: false,
  usedAsBuffer: false,
  usedAsPointer: false,
  virtualBases: [],
});

export const renameClassTemplateSpecializations = (
  entry: ClassTemplateEntry,
) => {
  // Don't bother working with partial specializations that are never used.
  const usedSpecializations = entry.partialSpecializations.filter((spec) =>
    spec.used
  );
  if (!entry.defaultSpecialization?.used) {
    // No default specialization: This template is governed by partial specializations.
    if (usedSpecializations.length === 0) {
      // A used ClassTemplateEntry should have at least one used specialization somewhere.
      throw new Error("Unreachable");
    } else if (usedSpecializations.length === 1) {
      // If only one partial specialization is used then it can use the template name directly.
      usedSpecializations[0].name = entry.name;
      return;
    }
  }
  usedSpecializations.forEach((spec) => {
    spec.name = `${entry.name}${spec.parameters.map((x) => x.name).join("")}`;
  });
};

export const markTemplateInstanceUsedAsBufferOrPointer = (
  entry: InlineClassTemplateTypeEntry,
  buffer: boolean,
): void => {
  if (!entry.specialization) {
    return;
  }
  if (buffer) {
    entry.specialization.usedAsBuffer = true;
  } else {
    entry.specialization.usedAsPointer = true;
  }
  entry.specialization.bases.forEach((base) => {
    switch (base.kind) {
      case "class":
        return markClassUsedAsBufferOrPointer(base, buffer);
      case "inline class<T>":
        return markTemplateInstanceUsedAsBufferOrPointer(base, buffer);
      case "typedef":
        return markTypedefUsedAsBufferOrPointer(base, buffer);
    }
  });
  entry.specialization.virtualBases.forEach((base) => {
    switch (base.kind) {
      case "class":
        return markClassUsedAsBufferOrPointer(base, buffer);
      case "inline class<T>":
        return markTemplateInstanceUsedAsBufferOrPointer(base, buffer);
      case "typedef":
        return markTypedefUsedAsBufferOrPointer(base, buffer);
    }
  });
};
