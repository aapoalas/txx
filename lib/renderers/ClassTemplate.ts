import pascalCase from "https://deno.land/x/case@2.1.1/pascalCase.ts";
import { ClassTemplateEntry, RenderData } from "../types.d.ts";
import { createRenderDataEntry } from "../utils.ts";
import { renderTypeAsFfi } from "./Type.ts";

export const renderClassTemplate = (
  { entriesInTypesFile, importsInTypesFile }: RenderData,
  entry: ClassTemplateEntry,
) => {
  const ClassT = `${entry.name}T`;
  const templateParameters: string[] = [];
  const callParameters: string[] = [];
  for (const param of entry.parameters) {
    const TypeName = pascalCase(param.name);
    templateParameters.push(`const ${TypeName}`);
    callParameters.push(
      `${param.name}: ${TypeName},`,
    );
  }
  const dependencies = new Set<string>();
  const contents = `export const ${ClassT} = <${templateParameters.join(", ")}>(
    ${callParameters.join("\n    ")}
) => ({
    struct: [
      ${
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
    }).join("\n")
  }
  ],
}) as const;
`;
  entriesInTypesFile.push(
    createRenderDataEntry([ClassT], [...dependencies], contents),
  );
};
