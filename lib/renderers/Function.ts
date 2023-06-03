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
  const data = `
export const ${namespace__method} = {
  name: "${entry.mangling}",
  parameters: [${
    entry.parameters.map((x) =>
      renderTypeAsFfi(dependencies, importsInBindingsFile, x.type)
    )
      .join(
        ", ",
      )
  }],
  result: ${renderTypeAsFfi(dependencies, importsInBindingsFile, entry.result)},
} as const;
`;
  entriesInBindingsFile.push(createDummyRenderDataEntry(data));
};
