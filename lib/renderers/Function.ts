import { SEP } from "../Context.ts";
import { FunctionEntry, RenderData } from "../types.d.ts";
import { createDummyRenderDataEntry } from "../utils.ts";
import { renderTypeAsFfi } from "./Type.ts";

export const renderFunction = (
  { bindings, entriesInBindingsFile, importsInBindingsFile }: RenderData,
  entry: FunctionEntry,
) => {
  const dependencies = new Set<string>();
  const namespace__method = entry.nsName.replaceAll(SEP, "__");
  bindings.add(namespace__method);
  entriesInBindingsFile.push(createDummyRenderDataEntry(renderFunctionExport(
    namespace__method,
    entry.mangling,
    entry.parameters.map((param) =>
      renderTypeAsFfi(dependencies, importsInBindingsFile, param.type)
    ),
    renderTypeAsFfi(dependencies, importsInBindingsFile, entry.result),
  )));
};

export const renderFunctionExport = (
  exportName: string,
  mangling: string,
  parameters: string[],
  result: string,
) =>
  `export const ${exportName} = {
  name: "${mangling}",
  parameters: [${parameters.join(", ")}],
  result: ${result},
} as const;
`;
