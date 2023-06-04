import pascalCase from "https://deno.land/x/case@2.1.1/pascalCase.ts";
import { CXType } from "https://deno.land/x/libclang@1.0.0-beta.8/mod.ts";
import { ClassTemplateEntry, RenderData } from "../types.d.ts";
import { createRenderDataEntry, typesFile } from "../utils.ts";
import { renderTypeAsFfi } from "./Type.ts";

export const renderClassTemplate = (
  { entriesInTypesFile, importsInTypesFile }: RenderData,
  entry: ClassTemplateEntry,
) => {
  const ClassT = `${entry.name}T`;
  const templateParameters: string[] = [];
  const callParameters: string[] = [];
  const inheritedPointers: string[] = [];
  const bases: string[] = [];
  const dependencies = new Set<string>();
  if (
    entry.partialSpecializations.length === 1 && entry.fields.length === 0 &&
    entry.bases.length === 0
  ) {
    // One partial specialization, main one is empty, presume all use this.
    // This works for `std::function`.
    const spec = entry.partialSpecializations[0];
    for (const base of spec.bases) {
      const BaseT = `${base.name}T`;
      const BasePointer = `${base.name}Pointer`;
      inheritedPointers.push(BasePointer);
      let baseType: CXType | null;
      if (base.kind === "inline class<T>") {
        importsInTypesFile.set(BasePointer, typesFile(base.template.file));
        importsInTypesFile.set(BaseT, typesFile(base.template.file));
        baseType = base.template.cursor.getType();
      } else {
        importsInTypesFile.set(BasePointer, typesFile(base.file));
        importsInTypesFile.set(BaseT, typesFile(base.file));
        baseType = base.cursor.getType();
      }

      if (!baseType) {
        // Zero-sized base type; this just provides eg. methods.
        continue;
      }

      const size = baseType.getSizeOf();
      const align = baseType.getAlignOf();
      bases.push(
        `${BaseT}, // base class, size ${size}, align ${align}`,
      );
    }

    for (const field of spec.fields) {
      const fieldType = field.cursor.getType()!;
      const size = fieldType.getSizeOf();
      const align = fieldType.getAlignOf();
      const sizeString = size > 0 ? `, size ${size}` : "";
      const alignString = align > 0 ? `, align ${align}` : "";
      const rawOffset = field.cursor.getOffsetOfField();
      const offsetString = rawOffset > 0 ? `, offset ${rawOffset / 8}` : "";
      bases.push(
        `${
          renderTypeAsFfi(dependencies, importsInTypesFile, field.type)
        }, // ${field.name}${offsetString}${sizeString}${alignString}`,
      );
    }
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
  for (const base of entry.bases) {
    const BaseT = `${base.name}T`;
    const BasePointer = `${base.name}Pointer`;
    inheritedPointers.push(BasePointer);
    let baseType: CXType;
    if (base.kind === "inline class<T>") {
      importsInTypesFile.set(BasePointer, typesFile(base.template.file));
      importsInTypesFile.set(BaseT, typesFile(base.template.file));
      baseType = base.template.cursor.getType()!;
    } else {
      importsInTypesFile.set(BasePointer, typesFile(base.file));
      importsInTypesFile.set(BaseT, typesFile(base.file));
      baseType = base.cursor.getType()!;
    }

    const size = baseType.getSizeOf();
    const align = baseType.getAlignOf();
    bases.push(
      `${BaseT}, // base class, size ${size}, align ${align}`,
    );
  }
  const contents = `export const ${ClassT} = <${templateParameters.join(", ")}>(
    ${callParameters.join("\n    ")}
) => ({
    struct: [
      ${
    bases.concat(
      entry.fields.map((field) => {
        const fieldType = field.cursor.getType()!;
        const size = fieldType.getSizeOf();
        const align = fieldType.getAlignOf();
        const sizeString = size > 0 ? `, size ${size}` : "";
        const alignString = align > 0 ? `, align ${align}` : "";
        const rawOffset = field.cursor.getOffsetOfField();
        const offsetString = rawOffset > 0 ? `, offset ${rawOffset / 8}` : "";
        return `${
          renderTypeAsFfi(dependencies, importsInTypesFile, field.type)
        }, // ${field.name}${offsetString}${sizeString}${alignString}`;
      }),
    ).join("\n")
  }
  ],
}) as const;
`;
  entriesInTypesFile.push(
    createRenderDataEntry([ClassT], [...dependencies], contents),
  );
};
