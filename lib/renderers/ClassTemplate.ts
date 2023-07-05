import pascalCase from "https://deno.land/x/case@2.1.1/pascalCase.ts";
import {
  AbsoluteTypesFilePath,
  ClassTemplateEntry,
  ClassTemplatePartialSpecialization,
  ImportMap,
  RenderData,
} from "../types.d.ts";
import {
  createRenderDataEntry,
  isPointer,
  isStruct,
  isStructOrTypedefStruct,
  SYSTEM_TYPES,
  typesFile,
} from "../utils.ts";
import { renderTypeAsFfi } from "./Type.ts";

export const renderClassTemplate = (
  renderData: RenderData,
  entry: ClassTemplateEntry,
) => {
  const { entriesInTypesFile } = renderData;
  const ClassT = `${entry.name}T`;
  const templateParameters: string[] = [];
  const callParameters: string[] = [];
  const dependencies = new Set<string>();
  const specializations: string[] = [];
  for (const specialization of entry.partialSpecializations) {
    const result = renderSpecialization(
      renderData,
      dependencies,
      specialization,
      entry,
    );
    if (result) {
      specializations.push(
        result,
      );
    }
  }
  const defaultSpec = renderSpecialization(
    renderData,
    dependencies,
    entry.defaultSpecialization,
    entry,
  );
  if (defaultSpec) {
    specializations.push(defaultSpec);
  }
  if (specializations.length === 0) {
    return;
  }
  for (const param of entry.parameters) {
    const TypeName = pascalCase(param.name);
    templateParameters.push(`const ${TypeName}`);
    callParameters.push(
      param.isSpread
        ? `...${param.name}: ${TypeName}[]`
        : `${param.name}: ${TypeName},`,
    );
  }
  const contents = `export const ${ClassT} = <${templateParameters.join(", ")}>(
    ${callParameters.join("\n    ")}
) => {
  ${specializations.join(" else ")}
};
`;
  entriesInTypesFile.push(
    createRenderDataEntry([ClassT], [...dependencies], contents),
  );
};

const renderSpecialization = (
  { importsInTypesFile }: RenderData,
  dependencies: Set<string>,
  specialization: ClassTemplatePartialSpecialization,
  entry: ClassTemplateEntry,
) => {
  if (!specialization.cursor.isDefinition()) {
    return `{
  throw new Error("Failed to build template class: No specialization matched");
}`;
  } else if (
    specialization.bases.length === 0 &&
    specialization.virtualBases.length === 0 &&
    specialization.fields.length === 0
  ) {
    return null;
  }

  if (specialization.usedAsBuffer || specialization.usedAsPointer) {
    console.group(entry.nsName);
    if (specialization.usedAsBuffer) {
      console.log("Is used as buffer");
    }
    if (specialization.usedAsPointer) {
      console.log("Is used as pointer");
    }
    console.groupEnd();
  }

  const replaceMap = new Map<string, string>();

  specialization.parameters.forEach((value, index) =>
    replaceMap.set(`type-parameter-0-${index}`, value.name)
  );

  const inheritedPointers: string[] = [];
  const fields: string[] = [];
  for (const base of specialization.bases) {
    const BaseT = renderTypeAsFfi(dependencies, importsInTypesFile, base);
    let baseTypeSource: AbsoluteTypesFilePath;
    if (base.kind === "inline class<T>") {
      baseTypeSource = typesFile(base.template.file);
    } else {
      baseTypeSource = typesFile(base.file);
    }
    const baseType = base.cursor.getType();
    if (!baseType) {
      // Zero-sized base type; this just provides eg. methods.
      continue;
    }
    if (
      fields.length === 0 && (isStruct(base) || isStructOrTypedefStruct(base))
    ) {
      // Pointer to class with inheritance is only usable
      // as the base class if the base class is concrete and
      // is the very first field in the inheriting class
      // and thus holds the vtable pointer.
      const BasePointer = `${base.name}Pointer`;
      inheritedPointers.push(BasePointer);
      importsInTypesFile.set(BasePointer, baseTypeSource);
    }
    importsInTypesFile.set(BaseT, baseTypeSource);

    const size = baseType.getSizeOf();
    const align = baseType.getAlignOf();
    fields.push(
      `${BaseT}, // base class, size ${size}, align ${align}`,
    );
  }

  for (const field of specialization.fields) {
    const fieldType = field.cursor.getType()!;
    const size = fieldType.getSizeOf();
    const align = fieldType.getAlignOf();
    const sizeString = size > 0 ? `, size ${size}` : "";
    const alignString = align > 0 ? `, align ${align}` : "";
    const rawOffset = field.cursor.getOffsetOfField();
    const offsetString = rawOffset > 0 ? `, offset ${rawOffset / 8}` : "";
    // TODO: field type is incorrectly 'inline class' when in reality it is a function pointer.
    fields.push(
      `${
        renderTypeAsFfi(
          dependencies,
          importsInTypesFile,
          field.type,
          replaceMap,
        )
      }, // ${field.name}${offsetString}${sizeString}${alignString}`,
    );
  }

  for (const base of specialization.virtualBases) {
    const BaseT = renderTypeAsFfi(dependencies, importsInTypesFile, base);
    let baseTypeSource: AbsoluteTypesFilePath;
    if (base.kind === "inline class<T>") {
      baseTypeSource = typesFile(base.template.file);
    } else {
      baseTypeSource = typesFile(base.file);
    }
    const baseType = base.cursor.getType();
    if (!baseType) {
      // Zero-sized base type; this just provides eg. methods.
      continue;
    }
    if (
      fields.length === 0 && (isStruct(base) || isStructOrTypedefStruct(base))
    ) {
      // Pointer to class with inheritance is only usable
      // as the base class if the base class is concrete and
      // is the very first field in the inheriting class
      // and thus holds the vtable pointer.
      const BasePointer = `${base.name}Pointer`;
      inheritedPointers.push(BasePointer);
      importsInTypesFile.set(BasePointer, baseTypeSource);
    }
    importsInTypesFile.set(BaseT, baseTypeSource);

    const size = baseType.getSizeOf();
    const align = baseType.getAlignOf();
    fields.push(
      `${BaseT}, // base class, size ${size}, align ${align}`,
    );
  }

  if (fields.length === 0) {
    return null;
  }

  const specializationCheckString = specialization.application.length
    ? `if (${generateTypeCheck(importsInTypesFile, specialization, entry)}) `
    : "";

  return `${specializationCheckString}{
  ${
    generateDestructuring(
      specialization,
      entry,
      dependencies,
      importsInTypesFile,
      replaceMap,
    )
  }
  return { struct: [
    ${fields.join("\n    ")}
] } as const;
}`;
};

const generateTypeCheck = (
  importsInTypesFile: ImportMap,
  specialization: ClassTemplatePartialSpecialization,
  entry: ClassTemplateEntry,
) => {
  if (
    specialization.application.length === 1
  ) {
    const application = specialization.application[0];
    if (
      typeof application === "object" &&
      application.kind === "fn"
    ) {
      importsInTypesFile.set("isFunction", SYSTEM_TYPES);
      return `isFunction(${entry.parameters[0].name})`;
    } else if (isPointer(application)) {
      return `${entry.parameters[0].name} === "pointer" || ${
        entry.parameters[0].name
      } === "buffer"`;
    }
  }
  throw new Error("Unknown template type check kind");
};

const generateDestructuring = (
  specialization: ClassTemplatePartialSpecialization,
  entry: ClassTemplateEntry,
  dependencies: Set<string>,
  importsInTypesFile: ImportMap,
  replaceMap: Map<string, string>,
) => {
  if (specialization.application.length === 0) {
    return "";
  } else if (
    specialization.application.length === 1
  ) {
    const application = specialization.application[0];
    if (isPointer(application) && application.pointee !== "self") {
      return `const ${
        renderTypeAsFfi(
          dependencies,
          importsInTypesFile,
          application.pointee,
          replaceMap,
        )
      } = ${entry.parameters[0].name};`;
    } else if (
      typeof application === "object"
    ) {
      return `const ${
        renderTypeAsFfi(
          dependencies,
          importsInTypesFile,
          application,
          replaceMap,
        )
      } = ${entry.parameters[0].name};`;
    }
  }
  throw new Error("Unknown template type check kind");
};
