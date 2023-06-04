import {
  CX_CXXAccessSpecifier,
  CXChildVisitResult,
  CXCursorKind,
  CXTypeKind,
} from "https://deno.land/x/libclang@1.0.0-beta.8/include/typeDefinitions.ts";
import {
  CXCursor,
  CXType,
} from "https://deno.land/x/libclang@1.0.0-beta.8/mod.ts";
import {
  AbsoluteFilePath,
  ClassContent,
  ClassEntry,
  ClassField,
  ClassTemplateEntry,
  ClassTemplatePartialSpecialization,
  ConstantArrayTypeEntry,
  EnumEntry,
  FunctionContent,
  FunctionEntry,
  FunctionTypeEntry,
  InlineClassTemplateTypeEntry,
  InlineClassTypeEntry,
  InlineUnionTypeEntry,
  Parameter,
  PointerTypeEntry,
  TemplateParameter,
  TypedefEntry,
  TypeEntry,
  UseableEntry,
  VarEntry,
} from "./types.d.ts";
import {
  getCursorFileLocation,
  getCursorNameTemplatePart,
  getFileNameFromCursor,
  getNamespacedName,
  getPlainTypeInfo,
  isConstantArray,
  isFunction,
  isInlineStruct,
  isPointer,
  isStruct,
  isTypedef,
} from "./utils.ts";

export const SEP = "::";
const PLAIN_METHOD_NAME_REGEX = /^[\w_]+$/i;

export class Context {
  #classes: ClassEntry[] = [];
  #classTemplates: ClassTemplateEntry[] = [];
  #enums: EnumEntry[] = [];
  #functions: FunctionEntry[] = [];
  #nsStack: string[] = [];
  #typedefs: TypedefEntry[] = [];
  #typedefTemplates = [];
  #vars: VarEntry[] = [];
  #useableEntries: UseableEntry[] = [];

  #createInlineTypeEntry(
    type: CXType,
  ):
    | InlineClassTypeEntry
    | InlineClassTemplateTypeEntry
    | InlineUnionTypeEntry {
    if (type.kind !== CXTypeKind.CXType_Record) {
      throw new Error(
        `Tried to create non-Record inline type '${type.getSpelling()}'`,
      );
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
          const fieldType = this.#visitType(maybeFieldCursor.getType()!);
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
        fields,
        kind: isUnion ? "inline union" : "inline class",
        type,
      };
    }
    const templateCursor = type.getTypeDeclaration()?.getSpecializedTemplate()
      ?.getCanonicalCursor() ?? null;
    if (templateCursor === null) {
      throw new Error("Could not find specialized template declaration cursor");
    }
    const templateName = getNamespacedName(templateCursor);
    const template = this.#classTemplates.find((entry) =>
      entry.nsName === templateName
    );
    if (!template) {
      throw new Error("Could not find template class entry");
    }
    this.#visitClassTemplate(templateName, templateCursor);
    const targc = type.getNumberOfTemplateArguments();
    const parameters: Parameter[] = [];
    for (let i = 0; i < targc; i++) {
      const targType = type.getTemplateArgumentAsType(i);
      if (!targType) {
        throw new Error("Could not get template argument type");
      }
      const parameterType = this.#visitType(targType);
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
      parameters,
      template,
      kind: "inline class<T>",
      name: template.name,
      nsName: template.nsName,
      type,
      file: template.file,
    };
  }

  #handleFunctionVisit(
    methodName: string,
    argv: Parameter[],
    cursor: CXCursor,
  ): null | TypeEntry {
    const argc = cursor.getNumberOfArguments();
    for (let i = 0; i < argc; i++) {
      const arg = cursor.getArgument(i);
      if (!arg) {
        throw new Error(
          `Could not find argument at index ${i} of function '${methodName}'`,
        );
      }
      const name = arg.getSpelling();
      const argType = arg.getType();
      if (!argType) {
        throw new Error(
          `Could not get argument type of argument '${name}' of function '${methodName}'`,
        );
      }
      let type: TypeEntry | null;
      try {
        type = this.#visitType(argType);
      } catch (err) {
        const newError = new Error(
          `Failed to visit type of argument '${name}' of function '${methodName}'`,
        );
        newError.cause = err;
        throw newError;
      }
      if (type === null) {
        throw new Error(
          `Type of argument '${name}' of function '${methodName}' was void`,
        );
      }
      if (typeof type === "object" && "used" in type) {
        type.used = true;
      }
      argv.push({
        kind: "parameter",
        comment: null,
        name,
        type,
      });
    }
    const rvType = cursor.getResultType();
    if (!rvType) {
      throw new Error(
        `Could not get return value type of function '${methodName}'`,
      );
    }
    try {
      const rv = this.#visitType(rvType);
      if (rv !== null && typeof rv === "object" && "used" in rv) {
        rv.used = true;
      }
      return rv;
    } catch (err) {
      const newError = new Error(
        `Failed to visit return value type of '${methodName}'`,
      );
      newError.cause = err;
      throw newError;
    }
  }

  #visitConstructor(
    entry: ClassEntry,
    importEntry: ClassContent,
    cursor: CXCursor,
  ): void {
    if (importEntry.constructors === false) {
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

    const parameters: Parameter[] = [];
    this.#handleFunctionVisit("Constructor", parameters, cursor);
    entry.constructors.push({
      parameters: parameters,
      cursor,
      manglings,
    });
  }

  #visitClassTemplate(nsName: string, templateCursor?: CXCursor): void {
    let foundEntry: ClassTemplateEntry | undefined;
    let foundPartialSpecialization:
      | ClassTemplatePartialSpecialization
      | undefined;
    if (templateCursor) {
      foundEntry = this.#classTemplates.find((entry) => {
        if (entry.cursor.equals(templateCursor)) {
          return entry;
        }
        const spec = entry.partialSpecializations.find((part) =>
          part.cursor.equals(templateCursor)
        );
        if (spec) {
          foundPartialSpecialization = spec;
          return entry;
        }
      });
    }
    if (!foundEntry) {
      foundEntry = this.#classTemplates.find((entry) =>
        entry.nsName === nsName
      );
    }
    if (!foundEntry) {
      throw new Error(`Could not find class template '${nsName}'`);
    }

    const classTemplateEntry = foundEntry;
    const partialSpecialization = foundPartialSpecialization;

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
            const ttype = gc.getType()!;
            const ttargc = ttype.getNumberOfTemplateArguments()!;
            const appliedParameters: TemplateParameter[] = [];
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
            console.groupEnd();
            const definition = gc.getDefinition();
            if (!definition) {
              throw new Error("No definition");
            }
            if (
              definition.kind === CXCursorKind.CXCursor_ClassDecl ||
              definition.kind === CXCursorKind.CXCursor_StructDecl
            ) {
              const nsName = getNamespacedName(definition);
              this.visitClass({
                constructors: false,
                destructors: false,
                kind: "class",
                methods: false,
                name: nsName,
              });
              const result = this.#classes.find((entry) =>
                entry.nsName === nsName
              );
              if (!result) {
                throw new Error("Couldn't find class");
              }
              spec.bases.push(result);
            } else if (
              definition.kind ===
                CXCursorKind.CXCursor_ClassTemplatePartialSpecialization
            ) {
              throw new Error(
                "Partial specialization points to partial specialization, please no",
              );
            } else if (
              definition.kind === CXCursorKind.CXCursor_ClassTemplate
            ) {
              this.#visitClassTemplate(
                getNamespacedName(definition),
                definition,
              );
              const found = this.#classTemplates.find((entry) =>
                entry.cursor.equals(definition)
              );
              if (!found) {
                throw new Error("Couldn't find class template");
              }
              spec.bases.push({
                file: found.file,
                kind: "inline class<T>",
                name: found.name,
                nsName: found.nsName,
                parameters: appliedParameters,
                template: found,
                type: ttype,
              });
            }
          }
          return 1;
        });

        console.groupEnd();
      }
    }

    const visitBasesAndFields = !classTemplateEntry.used;
    const visitPartialSpecializationFieldsAndBases = foundPartialSpecialization
      ? !foundPartialSpecialization.used
      : false;

    if (
      !visitBasesAndFields && !visitPartialSpecializationFieldsAndBases
    ) {
      // We're not going to visit fields, add constructors, destructors
      // or methods. Thus we do not need to visit children at all.
      return;
    }

    classTemplateEntry.used = true;

    classTemplateEntry.cursor.visitChildren(
      (gc: CXCursor): CXChildVisitResult => {
        if (
          gc.kind === CXCursorKind.CXCursor_CXXBaseSpecifier &&
          visitBasesAndFields
        ) {
          const definition = gc.getDefinition();
          if (!definition) {
            throw new Error(
              `Could not get definition of base class '${gc.getSpelling()}' of class '${classTemplateEntry.name}' ${gc.getKindSpelling()}`,
            );
          }
          try {
            const baseClassName = definition.getSpelling();
            this.visitClass({
              constructors: false,
              destructors: false,
              kind: "class",
              methods: false,
              name: baseClassName,
            });
            const baseClass = this.#classes.find((entry) =>
              entry.name === baseClassName || entry.nsName === baseClassName
            ) || this.#classTemplates.find((entry) =>
              entry.cursor.equals(gc.getDefinition()!)
            ) || this.#classTemplates.find((entry) =>
              entry.name === baseClassName || entry.nsName === baseClassName
            );
            if (!baseClass) {
              throw new Error("Could not find base class");
            } else if (baseClass.kind === "class") {
              classTemplateEntry.bases.push(baseClass);
            } else if (baseClass.kind === "class<T>") {
              classTemplateEntry.bases.push({
                kind: "inline class<T>",
                name: baseClass.name,
                nsName: baseClass.nsName,
                parameters: [],
                template: baseClass,
                type: gc.getType()!,
                file: baseClass.file,
              });
            }
          } catch (err) {
            const baseError = new Error(
              `Failed to visit base class '${gc.getSpelling()}' of class '${classTemplateEntry.name}'`,
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
            field = this.#visitType(type);
          } catch (err) {
            const access = gc.getCXXAccessSpecifier();
            if (
              access === CX_CXXAccessSpecifier.CX_CXXPrivate ||
              access === CX_CXXAccessSpecifier.CX_CXXProtected
            ) {
              // Failure to accurately describe a private or protected field is not an issue.
              field = "buffer";
            } else {
              const newError = new Error(
                `Failed to visit class field '${gc.getSpelling()}' of class '${classTemplateEntry.name}'`,
              );
              newError.cause = err;
              throw newError;
            }
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
      return;
    }

    partialSpecialization.used = true;

    partialSpecialization.cursor.visitChildren((gc) => {
      if (
        gc.kind === CXCursorKind.CXCursor_CXXBaseSpecifier &&
        visitPartialSpecializationFieldsAndBases
      ) {
        const definition = gc.getDefinition();
        if (!definition) {
          throw new Error(
            `Could not get definition of base class '${gc.getSpelling()}' of class '${classTemplateEntry.name}' ${gc.getKindSpelling()}`,
          );
        }
        try {
          const baseClassName = definition.getSpelling();
          if (definition.kind === CXCursorKind.CXCursor_ClassTemplate) {
            this.#visitClassTemplate(getNamespacedName(definition), definition);
            const entry = this.#classTemplates.find((entry) =>
              entry.cursor.equals(definition)
            );
            if (!entry) {
              throw new Error("Unexpected no class template entry found");
            }
            partialSpecialization.bases.push({
              kind: "inline class<T>",
              template: entry,
              name: entry.name,
              nsName: entry.nsName,
              parameters: [],
              type: gc.getType()!,
              file: entry.file,
            });
          } else {
            this.visitClass({
              constructors: false,
              destructors: false,
              kind: "class",
              methods: false,
              name: baseClassName,
            });
            const baseClass = this.#classes.find((entry) =>
              entry.name === baseClassName
            );
            if (!baseClass) {
              throw new Error("Unexpected no class entry found");
            }
            partialSpecialization.bases.push(baseClass);
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
          field = this.#visitType(type);
        } catch (err) {
          const access = gc.getCXXAccessSpecifier();
          if (
            access === CX_CXXAccessSpecifier.CX_CXXPrivate ||
            access === CX_CXXAccessSpecifier.CX_CXXProtected
          ) {
            // Failure to accurately describe a private or protected field is not an issue.
            field = "buffer";
          } else {
            const newError = new Error(
              `Failed to visit class field '${gc.getSpelling()}' of class '${classTemplateEntry.name}'`,
            );
            newError.cause = err;
            throw newError;
          }
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
  }

  #visitDestructor(
    entry: ClassEntry,
    importEntry: ClassContent,
    cursor: CXCursor,
  ): void {
    if (importEntry.destructors === false || entry.destructor !== null) {
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

    const parameters: Parameter[] = [];
    this.#handleFunctionVisit("Destructor", parameters, cursor);
    entry.destructor = {
      cursor,
      manglings: cursor.getCXXManglings(),
    };
  }

  #visitMethod(
    entry: ClassEntry,
    importEntry: ClassContent,
    cursor: CXCursor,
  ): void {
    if (importEntry.methods === false) {
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

    const parameters: Parameter[] = [];
    const result = this.#handleFunctionVisit(methodName, parameters, cursor);
    entry.methods.push({
      parameters,
      cursor,
      mangling,
      name: methodName,
      result,
    });
  }

  #visitType(type: CXType): null | TypeEntry {
    const kind = type.kind;
    if (kind === CXTypeKind.CXType_Void) {
      return null;
    }
    const name = type.isConstQualifiedType()
      ? type.getSpelling().substring(6)
      : type.getSpelling();
    if (kind === CXTypeKind.CXType_Typedef) {
      const found = this.#typedefs.find((entry) =>
        entry.name === name || entry.nsName === name
      );
      if (!found) {
        throw new Error(`Could not find typedef '${name}'`);
      }
      found.used = true;
      if (found.target === null) {
        const referredType = found.cursor
          .getTypedefDeclarationOfUnderlyingType();
        if (!referredType) {
          throw new Error(`Could not find referred type for typedef '${name}'`);
        }
        const result = this.#visitType(referredType);
        found.target = result;
      }
      return found;
    } else if (kind === CXTypeKind.CXType_Unexposed) {
      const canonicalType = type.getCanonicalType();
      if (canonicalType.kind !== CXTypeKind.CXType_Unexposed) {
        return this.#visitType(canonicalType);
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
            const targType = this.#visitType(targ);
            if (!targType) {
              throw new Error("Unexpected null template argument type");
            } else if (
              targType === "buffer" && targ.kind === CXTypeKind.CXType_Unexposed
            ) {
              parameters.push({
                kind: "<T>",
                name: targ.getSpelling(),
                isSpread:
                  targ.getTypeDeclaration()?.getPrettyPrinted()?.includes(
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
          this.#classTemplates.push(template);
          this.#useableEntries.push(template);
          return {
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
      return this.#visitType(type.getNamedType()!);
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
      const result = this.#visitType(pointee);
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
      const found = this.#enums.find((entry) =>
        entry.name === name || entry.nsName === name
      );
      if (!found) {
        throw new Error(`Could not find enum '${name}'`);
      }
      found.used = true;
      if (found.type === null) {
        const integerType = found.cursor.getEnumDeclarationIntegerType();
        if (!integerType) {
          throw new Error(`Could not find integer type for enum '${name}'`);
        }
        const result = this.#visitType(integerType);
        if (result === null) {
          throw new Error(`Found void integer value for enum '${name}'`);
        }
        found.type = result;
      }
      return found;
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
      const isStruct =
        type.getCanonicalType().kind === CXTypeKind.CXType_Record;
      if (isStruct) {
        if (
          type.getSizeOf() === -2 && type.getNumberOfTemplateArguments() === -1
        ) {
          // This class or struct is only forward-declared in our headers:
          // This is usually not really an issue and we shouldn't care about it.
          // It's just an opaque type. If this type needs to be used then we have
          // an issue, but most likely this is just used as an opaque pointer in
          // which case there is no issue.
          return {
            fields: [],
            type,
            kind: "inline class",
          };
        }
        const entry = this.#classes.find((entry) =>
          entry.name === name || entry.nsName === name
        );
        if (!entry) {
          return this.#createInlineTypeEntry(type);
        }
        this.visitClass({
          constructors: false,
          destructors: false,
          kind: "class",
          methods: false,
          name,
        });
        return entry;
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
      const typeEntry = this.#visitType(elemType);
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
        const parameterType = this.#visitType(argType);
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
      const result = this.#visitType(resultType);
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
  }

  addClass(cursor: CXCursor): void {
    if (!cursor.isDefinition()) {
      // Forward declaration
      return;
    }
    const name = cursor.getSpelling();
    if (!name) {
      // Anonymous struct
      return;
    }
    const nameTemplatePart = getCursorNameTemplatePart(cursor);
    const nsName = this.#nsStack.length
      ? `${this.#nsStack.join("::")}${SEP}${name}${nameTemplatePart}`
      : `${name}${nameTemplatePart}`;

    const entry = {
      bases: [],
      constructors: [],
      cursor,
      destructor: null,
      fields: [],
      file: getFileNameFromCursor(cursor),
      kind: "class",
      methods: [],
      name,
      nsName,
      used: false,
      virtualBases: [],
      size: cursor.getType()?.getSizeOf() ?? -1,
    } satisfies ClassEntry;
    this.#classes.push(entry);
    this.#useableEntries.push(entry);
  }

  addClassTemplate(cursor: CXCursor): void {
    const name = cursor.getSpelling();
    if (!name) {
      // Anonymous struct
      return;
    }

    const nsName = this.#nsStack.length
      ? `${this.#nsStack.join("::")}${SEP}${name}`
      : name;
    const entry = {
      bases: [],
      constructors: [],
      cursor,
      destructor: null,
      fields: [],
      file: getFileNameFromCursor(cursor),
      kind: "class<T>",
      methods: [],
      name,
      nsName,
      parameters: [],
      used: false,
      partialSpecializations: [],
    } satisfies ClassTemplateEntry;
    this.#classTemplates.push(entry);
    this.#useableEntries.push(entry);
  }

  addClassTemplatePartialSpecialization(cursor: CXCursor): void {
    const spec = cursor.getSpecializedTemplate();
    if (!spec) {
      throw new Error("Couldn't get specialized template cursor");
    }
    const source = this.#classTemplates.find((entry) =>
      entry.cursor.equals(spec)
    );
    if (!source) {
      throw new Error(
        `Could not find class template for ${getNamespacedName(cursor)}`,
      );
    }
    source.partialSpecializations.push({
      bases: [],
      cursor,
      fields: [],
      kind: "partial class<T>",
      parameters: [],
      used: false,
    });
  }

  addEnum(cursor: CXCursor): void {
    if (!cursor.isDefinition()) {
      // Forward declaration
      return;
    }
    const name = cursor.getSpelling();
    if (!name) {
      // Anonymous enum
      return;
    }
    const nsName = this.#nsStack.length
      ? `${this.#nsStack.join("::")}${SEP}${name}`
      : name;

    const entry = {
      cursor,
      file: getFileNameFromCursor(cursor),
      kind: "enum",
      name,
      nsName,
      type: null,
      used: false,
    } satisfies EnumEntry;
    this.#enums.push(entry);
    this.#useableEntries.push(entry);
  }

  addFunction(name: string, cursor: CXCursor): void {
    if (!cursor.isDefinition()) {
      // Forward declaration
      return;
    }

    if (
      name.includes("operator") &&
      !PLAIN_METHOD_NAME_REGEX.test(name)
    ) {
      throw new Error(`Found unexpected operator function '${name}`);
    }

    const nsName = this.#nsStack.length
      ? `${this.#nsStack.join("::")}${SEP}${name}`
      : name;
    const entry = {
      parameters: [],
      cursor,
      file: getFileNameFromCursor(cursor),
      kind: "function",
      mangling: cursor.getMangling(),
      name,
      nsName,
      result: null,
      used: false,
    } satisfies FunctionEntry;
    this.#functions.push(entry);
    this.#useableEntries.push(entry);
  }

  addTypeDefinition(cursor: CXCursor): void {
    if (!cursor.isDefinition()) {
      // Forward declaration
      return;
    }
    const name = cursor.getSpelling();
    if (!name) {
      // Anonymous definition, this is likely eg. `typedef enum {} Name`
      return;
    }

    const nameTemplatePart = getCursorNameTemplatePart(cursor);

    const nsName = this.#nsStack.length
      ? `${this.#nsStack.join("::")}${SEP}${name}${nameTemplatePart}`
      : `${name}${nameTemplatePart}`;

    const entry = {
      cursor,
      file: getFileNameFromCursor(cursor),
      kind: "typedef",
      name,
      nsName,
      target: null,
      used: false,
    } satisfies TypedefEntry;
    this.#typedefs.push(entry);
    this.#useableEntries.push(entry);
  }

  addVar(cursor: CXCursor): void {
    if (!cursor.isDefinition()) {
      return;
    }
    const name = cursor.getSpelling();
    if (!name) {
      return;
    }

    const nameTemplatePart = getCursorNameTemplatePart(cursor);

    const nsName = this.#nsStack.length
      ? `${this.#nsStack.join("::")}${SEP}${name}${nameTemplatePart}`
      : `${name}${nameTemplatePart}`;

    const entry = {
      cursor,
      file: getFileNameFromCursor(cursor),
      kind: "var",
      mangling: cursor.getMangling(),
      name,
      nsName,
      type: null,
      used: false,
    } satisfies VarEntry;
    this.#vars.push(entry);
    this.#useableEntries.push(entry);
  }

  getUsedData(): Map<
    AbsoluteFilePath,
    UseableEntry[]
  > {
    const map = new Map<
      AbsoluteFilePath,
      UseableEntry[]
    >();

    for (const entry of this.#useableEntries) {
      if (!entry.used) {
        continue;
      }
      const fileEntries = map.get(entry.file) ||
        map.set(entry.file, []).get(entry.file)!;

      if (entry.kind === "class" || entry.kind === "class<T>") {
        replaceSelfReferentialFieldValues(entry);
      }

      fileEntries.push(entry);
    }

    return map;
  }

  visitClass(importEntry: ClassContent): void {
    const foundClasses = this.#classes.filter((entry) =>
      entry.name === importEntry.name || entry.nsName === importEntry.name
    );
    if (foundClasses.length === 0) {
      const foundTypeDefs = this.#typedefs.filter((entry) =>
        entry.name === importEntry.name || entry.nsName == importEntry.name
      );
      if (foundTypeDefs.length === 1) {
        const [typedefEntry] = foundTypeDefs;
        if (typedefEntry.target === null) {
          const referredType = typedefEntry.cursor
            .getTypedefDeclarationOfUnderlyingType();
          if (!referredType) {
            throw new Error(
              `Could not find referred type for typedef '${typedefEntry.name}'`,
            );
          }
          const result = this.#visitType(referredType);
          typedefEntry.target = result;
        }
        typedefEntry.used = true;
        return;
      }
      const foundClassTemplates = this.#classTemplates.filter((entry) =>
        entry.name === importEntry.name || entry.nsName === importEntry.name
      );
      if (foundClassTemplates.length === 1) {
        const [classTemplateEntry] = foundClassTemplates;
        this.#visitClassTemplate(classTemplateEntry.nsName);
        return;
      }
      throw new Error(`Could not find class '${importEntry.name}'`);
    }

    if (foundClasses.length > 1) {
      throw new Error(
        `Found multiple classes with name '${importEntry.name}': Use namespaced name to narrow down the search`,
      );
    }

    const [classEntry] = foundClasses;

    const visitBasesAndFields = !classEntry.used;

    if (
      !visitBasesAndFields && !importEntry.constructors &&
      !importEntry.destructors &&
      (!importEntry.methods ||
        Array.isArray(importEntry.methods) && importEntry.methods.length === 0)
    ) {
      // We're not going to visit fields, add constructors, destructors
      // or methods. Thus we do not need to visit children at all.
      return;
    }

    classEntry.used = true;

    classEntry.cursor.visitChildren((gc) => {
      if (
        gc.kind === CXCursorKind.CXCursor_CXXBaseSpecifier &&
        visitBasesAndFields
      ) {
        const definition = gc.getDefinition();
        if (!definition) {
          throw new Error(
            `Could not get definition of base class '${gc.getSpelling()}' of class '${classEntry.name}'`,
          );
        }
        try {
          const isVirtualBase = gc.isVirtualBase();
          const baseClassName = definition.getSpelling();
          this.visitClass({
            // Constructors are always concrete, inheritance
            // doesn't need the parent constructors in API.
            constructors: false,
            // Destructors might be relevant?
            destructors: importEntry.destructors,
            kind: "class",
            methods: importEntry.methods,
            name: baseClassName,
          });
          const baseClass = this.#classes.find((entry) =>
            entry.name === baseClassName || entry.nsName === baseClassName
          );
          if (!baseClass) {
            // Base class was found through typedefs.
            const baseTypedef = this.#typedefs.find((entry) =>
              entry.name === baseClassName || entry.nsName === baseClassName
            );
            if (!baseTypedef) {
              throw new Error("Unexpected no typedef base class");
            }
            // Typedef base class is just a Uint8Array in the end:
            // We do not care about this.
            if (isVirtualBase) {
              classEntry.virtualBases.push(baseTypedef);
            } else {
              classEntry.bases.push(baseTypedef);
            }
          } else if (isVirtualBase) {
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
          this.#visitMethod(classEntry, importEntry, gc);
        } catch (err) {
          const newError = new Error(
            `Failed to visit method '${gc.getSpelling()}' of class '${classEntry.name}'`,
          );
          newError.cause = err;
          throw newError;
        }
      } else if (gc.kind === CXCursorKind.CXCursor_Constructor) {
        try {
          this.#visitConstructor(classEntry, importEntry, gc);
        } catch (err) {
          const newError = new Error(
            `Failed to visit constructor '${gc.getSpelling()}' of class '${classEntry.name}'`,
          );
          newError.cause = err;
          throw newError;
        }
      } else if (gc.kind === CXCursorKind.CXCursor_Destructor) {
        try {
          this.#visitDestructor(classEntry, importEntry, gc);
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
          field = this.#visitType(type);
        } catch (err) {
          const access = gc.getCXXAccessSpecifier();
          if (
            access === CX_CXXAccessSpecifier.CX_CXXPrivate ||
            access === CX_CXXAccessSpecifier.CX_CXXProtected
          ) {
            // Failure to accurately describe a private or protected field is not an issue.
            field = "buffer";
          } else {
            const newError = new Error(
              `Failed to visit class field '${gc.getSpelling()}' of class '${classEntry.name}'`,
            );
            newError.cause = err;
            throw newError;
          }
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
  }

  visitFunction(importEntry: FunctionContent): void {
    const found = this.#functions.find((entry) =>
      entry.name === importEntry.name || entry.nsName === importEntry.name
    );
    if (!found) {
      throw new Error(`Could not find function '${importEntry.name}'`);
    }
    found.result = this.#handleFunctionVisit(
      found.name,
      found.parameters,
      found.cursor,
    );
  }

  pushToNamespaceStack(namespace: string) {
    this.#nsStack.push(namespace);
  }

  popFromNamespaceStack() {
    this.#nsStack.pop();
  }
}

const replaceSelfReferentialFieldValues = (
  source: ClassEntry | ClassTemplateEntry,
) => {
  const visitorCallback = (entry: null | TypeEntry) => {
    if (entry === source) {
      throw new Error("Class self-refers itself");
    }
    if (isTypedef(entry)) {
      visitorCallback(entry.target);
    } else if (isPointer(entry)) {
      if (entry.pointee === "self" || entry.pointee === source) {
        entry.pointee = "self";
        return;
      }
      visitorCallback(entry.pointee);
    } else if (isFunction(entry)) {
      entry.parameters.forEach((parameter) => visitorCallback(parameter.type));
      visitorCallback(entry.result);
    } else if (
      isStruct(entry) || isInlineStruct(entry)
    ) {
      entry.fields.forEach((field) => visitorCallback(field.type));
    } else if (isConstantArray(entry)) {
      visitorCallback(entry.element);
    }
  };
  source.fields.forEach((field) => {
    visitorCallback(field.type);
  });
};
