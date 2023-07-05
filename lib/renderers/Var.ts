import { SEP } from "../Context.ts";
import { RenderData, VarEntry } from "../types.d.ts";
import { createDummyRenderDataEntry } from "../utils.ts";
import { renderTypeAsFfi } from "./Type.ts";

export const renderVar = ({
  entriesInBindingsFile,
  importsInBindingsFile,
}: RenderData, entry: VarEntry) =>
  void entriesInBindingsFile.push(createDummyRenderDataEntry(
    `export const ${entry.nsName.replaceAll(SEP, "__")} = {
  name: "${entry.mangling}",
  type: ${renderTypeAsFfi(new Set(), importsInBindingsFile, entry.type)},
} as const;
`,
  ));
