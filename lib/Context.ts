import {
  CXChildVisitResult,
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
  EnumEntry,
  FunctionContent,
  FunctionEntry,
  TypeEntry,
  TypedefEntry,
  UnionEntry,
  UseableEntry,
  VarContent,
  VarEntry,
} from "./types.d.ts";
import {
  getCursorNameTemplatePart,
  getFileNameFromCursor,
  getNamespacedName,
  isConstantArray,
  isFunction,
  isInlineStruct,
  isInlineTemplateStruct,
  isPointer,
  isStruct,
  isTypedef,
  isUnion
} from "./utils.ts";
import { visitClassEntry } from "./visitors/Class.ts";
import { visitClassTemplateEntry } from "./visitors/ClassTemplate.ts";
import { visitFunctionCursor } from "./visitors/Function.ts";
import { visitTypedefEntry } from "./visitors/Typedef.ts";
import { visitVarEntry } from "./visitors/Var.ts";

export const SEP = "::";

export class Context {
  #classes: ClassEntry[] = [];
  #classTemplates: ClassTemplateEntry[] = [];
  #enums: EnumEntry[] = [];
  #functions: FunctionEntry[] = [];
  #nsStack: string[] = [];
  #typedefs: TypedefEntry[] = [];
  #typedefTemplates = [];
  #unions: UnionEntry[] = [];
  #vars: VarEntry[] = [];
  #useableEntries: UseableEntry[] = [];

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
      usedAsBuffer: false,
      usedAsPointer: false,
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
    const defaultSpecialization: ClassTemplatePartialSpecialization = {
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
    };
    const entry = {
      cursor,
      defaultSpecialization,
      file: getFileNameFromCursor(cursor),
      kind: "class<T>",
      name,
      nsName,
      parameters: [],
      partialSpecializations: [],
      used: false,
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

  addFunction(cursor: CXCursor): void {
    const name = cursor.getSpelling();
    if (!name) {
      // Anonymous function?
      return;
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

  addUnion(cursor: CXCursor): void {
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
      kind: "union",
      name,
      nsName,
      fields: [],
      used: false,
    } satisfies UnionEntry;
    this.#unions.push(entry);
    this.#useableEntries.push(entry);
  }

  visitClass(importEntry: ClassContent): void {
    const classEntry = this.findClassByName(importEntry.name);
    if (classEntry) {
      visitClassEntry(this, classEntry, importEntry);
      return;
    }
    const classTemplateEntry = this.findClassTemplateByName(importEntry.name);
    if (classTemplateEntry) {
      visitClassTemplateEntry(this, classTemplateEntry);
      return;
    }
    const typedefEntry = this.findTypedefByName(importEntry.name);
    if (typedefEntry) {
      visitTypedefEntry(this, typedefEntry.cursor);
      return;
    }
    throw new Error(`Could not find class with name '${importEntry.name}'`);
  }

  visitClassLikeByCursor(
    cursor: CXCursor,
    importEntry?: ClassContent,
  ): ClassEntry | ClassTemplateEntry | TypedefEntry {
    const classEntry = this.findClassByCursor(cursor);
    if (classEntry) {
      return visitClassEntry(this, classEntry, importEntry);
    }
    const classTemplateEntry = this.findClassTemplateByCursor(cursor);
    if (classTemplateEntry) {
      return visitClassTemplateEntry(this, classTemplateEntry);
    }
    const typedefEntry = this.findTypedefByCursor(cursor);
    if (typedefEntry) {
      return visitTypedefEntry(this, typedefEntry.cursor);
    }
    const hasChildren = cursor.visitChildren(() =>
      CXChildVisitResult.CXChildVisit_Break
    );
    if (hasChildren) {
      throw new Error(
        `Unexpectedly found an unregistered class entry with children '${getNamespacedName(cursor)
        }'`,
      );
    }
    const specialized = cursor.getSpecializedTemplate();
    if (!specialized || specialized.equals(cursor)) {
      throw new Error(
        `Unexpectedly found an unregistered class that did not specialize a template '${getNamespacedName(cursor)
        }'`,
      );
    }
    return this.visitClassLikeByCursor(specialized, importEntry);
  }

  visitFunction(importEntry: FunctionContent): void {
    const found = this.#functions.find((entry) =>
      entry.name === importEntry.name || entry.nsName === importEntry.name
    );
    if (!found) {
      throw new Error(`Could not find function '${importEntry.name}'`);
    }
    const result = visitFunctionCursor(
      this,
      found.cursor,
    );

    found.parameters = result.parameters;
    found.result = result.result;
    found.used = true;
  }

  visitVar(importEntry: VarContent): void {
    const found = this.#vars.find((entry) =>
      entry.name === importEntry.name || entry.nsName === importEntry.name
    );
    if (!found) {
      throw new Error(`Could not find var '${importEntry.name}'`);
    }

    visitVarEntry(
      this,
      found,
    );
  }

  pushToNamespaceStack(namespace: string) {
    this.#nsStack.push(namespace);
  }

  popFromNamespaceStack() {
    this.#nsStack.pop();
  }

  findClassByCursor(cursor: CXCursor) {
    return this.#classes.find((entry) => entry.cursor.equals(cursor));
  }

  findClassByName(name: string) {
    const nsMatch = this.#classes.find((entry) => entry.nsName === name);
    if (nsMatch) {
      return nsMatch;
    }
    const nameMatches = this.#classes.filter((entry) => entry.name === name);
    if (nameMatches.length === 1) {
      return nameMatches[0];
    } else if (nameMatches.length > 1) {
      throw new Error(
        `Searching for class by name produced multiple matches: Use namespaced name to narrow down the search`,
      );
    }
  }

  findClassByType(type: CXType) {
    const declaration = type.getTypeDeclaration();
    if (declaration) {
      return this.findClassByCursor(declaration);
    } else {
      const name = type.getSpelling();
      return this.findClassByName(
        type.isConstQualifiedType() ? name.substring(6) : name,
      );
    }
  }

  findClassTemplateByCursor(cursor: CXCursor) {
    return this.#classTemplates.find((entry) =>
      entry.cursor.equals(cursor) ||
      entry.partialSpecializations.some((spec) => spec.cursor.equals(cursor))
    );
  }

  findClassTemplateByName(name: string) {
    const nsMatch = this.#classTemplates.find((entry) => entry.nsName === name);
    if (nsMatch) {
      return nsMatch;
    }
    const nameMatches = this.#classTemplates.filter((entry) =>
      entry.name === name
    );
    if (nameMatches.length === 1) {
      return nameMatches[0];
    } else if (nameMatches.length > 1) {
      throw new Error(
        `Searching for classtemplate by name produced multiple matches: Use namespaced name to narrow down the search`,
      );
    }
  }

  findClassTemplateByType(type: CXType) {
    const declaration = type.getTypeDeclaration();
    if (declaration) {
      return this.findClassTemplateByCursor(declaration);
    } else {
      const name = type.getSpelling();
      return this.findClassTemplateByName(
        type.isConstQualifiedType() ? name.substring(6) : name,
      );
    }
  }

  findUnionByCursor(cursor: CXCursor) {
    return this.#unions.find((entry) => entry.cursor.equals(cursor));
  }

  findFunctionByCursor(cursor: CXCursor) {
    return this.#functions.find((entry) => entry.cursor.equals(cursor));
  }

  findFunctionByName(name: string) {
    const nsMatch = this.#functions.find((entry) => entry.nsName === name);
    if (nsMatch) {
      return nsMatch;
    }
    const nameMatches = this.#functions.filter((entry) => entry.name === name);
    if (nameMatches.length === 1) {
      return nameMatches[0];
    } else if (nameMatches.length > 1) {
      throw new Error(
        `Searching for function by name produced multiple matches: Use namespaced name to narrow down the search`,
      );
    }
  }

  findFunctionByType(type: CXType) {
    const declaration = type.getTypeDeclaration();
    if (declaration) {
      return this.findFunctionByCursor(declaration);
    } else {
      const name = type.getSpelling();
      return this.findFunctionByName(
        type.isConstQualifiedType() ? name.substring(6) : name,
      );
    }
  }

  findTypedefByCursor(cursor: CXCursor) {
    return this.#typedefs.find((entry) => entry.cursor.equals(cursor));
  }

  findTypedefByName(name: string) {
    const nsMatch = this.#typedefs.find((entry) => entry.nsName === name);
    if (nsMatch) {
      return nsMatch;
    }
    const nameMatches = this.#typedefs.filter((entry) => entry.name === name);
    if (nameMatches.length === 1) {
      return nameMatches[0];
    } else if (nameMatches.length > 1) {
      throw new Error(
        `Searching for typedef by name produced multiple matches: Use namespaced name to narrow down the search`,
      );
    }
  }

  findTypedefByType(type: CXType) {
    const declaration = type.getTypeDeclaration();
    if (declaration) {
      return this.findTypedefByCursor(declaration);
    } else {
      const name = type.getSpelling();
      return this.findTypedefByName(
        type.isConstQualifiedType() ? name.substring(6) : name,
      );
    }
  }

  getClasses() {
    return this.#classes;
  }

  getClassTemplates() {
    return this.#classTemplates;
  }

  getEnums() {
    return this.#enums;
  }

  getTypedefs() {
    return this.#typedefs;
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
}

const replaceSelfReferentialFieldValues = (
  source: ClassEntry | ClassTemplateEntry,
) => {
  const visitorCallback = (entry: null | TypeEntry) => {
    if (entry === source) {
      throw new Error("Class self-refers itself");
    }
    if (typeof entry === "string" || !entry) {
      return;
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
    } else if (isUnion(entry)) {
      entry.fields.forEach(visitorCallback);
    } else if (isInlineTemplateStruct(entry)) {
      entry.parameters.forEach((param) =>
        param.kind === "parameter" ? visitorCallback(param.type) : null
      );
      entry.specialization.fields.forEach((field) =>
        visitorCallback(field.type)
      );
    }
  };
  const cb = (field: ClassField) => {
    visitorCallback(field.type);
  };
  if (source.kind === "class") {
    source.fields.forEach(cb);
  } else {
    source.defaultSpecialization.fields.forEach(cb);
    source.partialSpecializations.forEach((spec) => spec.fields.forEach(cb));
  }
};
