import { RenderData, UnionEntry } from "../types.d.ts";
import {
  createRenderDataEntry,
  getSizeOfType,
  SYSTEM_TYPES,
} from "../utils.ts";
import { renderTypeAsFfi } from "./Type.ts";

export const renderUnion = (
  {
    entriesInTypesFile,
    importsInTypesFile,
  }: RenderData,
  entry: UnionEntry,
) => {
  const dependencies = new Set<string>();
  const nameT = `${entry.name}T`;

  const uniqueSortedFields = new Set(
    entry.fields.sort((a, b) => getSizeOfType(b) - getSizeOfType(a)).map(
      (field) => renderTypeAsFfi(dependencies, importsInTypesFile, field),
    ),
  );
  importsInTypesFile.set(`union${uniqueSortedFields.size}`, SYSTEM_TYPES);
  const typesEntry = `export const ${nameT} = union${uniqueSortedFields.size}(
  ${[...uniqueSortedFields].join(", ")}
)`;

  entriesInTypesFile.push(
    createRenderDataEntry([nameT], [...dependencies], typesEntry),
  );
};
