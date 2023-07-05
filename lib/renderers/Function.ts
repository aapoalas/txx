import { SEP } from "../Context.ts";
import {
  FunctionEntry,
  ImportMap,
  Parameter,
  RenderData,
  TypeEntry,
} from "../types.d.ts";
import {
  createDummyRenderDataEntry,
  isInlineTemplateStruct,
  isPassableByValue,
  isStruct,
  SYSTEM_TYPES,
} from "../utils.ts";
import { renderTypeAsFfi } from "./Type.ts";

export const renderFunction = (
  { bindings, entriesInBindingsFile, importsInBindingsFile }: RenderData,
  entry: FunctionEntry,
) => {
  const dependencies = new Set<string>();
  const namespace__method = entry.nsName.replaceAll(SEP, "__");
  bindings.add(namespace__method);
  const parameterStrings = entry.parameters.map((param) =>
    renderFunctionParameter(dependencies, importsInBindingsFile, param)
  );
  const returnType = renderFunctionReturnType(
    dependencies,
    importsInBindingsFile,
    entry.result,
    parameterStrings,
  );
  entriesInBindingsFile.push(createDummyRenderDataEntry(renderFunctionExport(
    namespace__method,
    entry.mangling,
    parameterStrings,
    returnType,
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

export const renderFunctionParameter = (
  dependencies: Set<string>,
  importsInBindingsFile: ImportMap,
  param: Parameter,
) => {
  const isPassedByValue = isPassableByValue(param.type);
  const result = renderTypeAsFfi(
    dependencies,
    importsInBindingsFile,
    param.type,
  );
  if (isPassedByValue) {
    return result;
  }
  let useBuffer = true;
  if (isStruct(param.type)) {
    // Use buffer if explicitly asked or if not explicitly asked to use pointer.
    useBuffer = param.type.usedAsBuffer || !param.type.usedAsPointer;
  } else if (isInlineTemplateStruct(param.type)) {
    useBuffer = param.type.specialization.usedAsBuffer ||
      !param.type.specialization.usedAsPointer;
  }
  if (useBuffer) {
    importsInBindingsFile.set("buf", SYSTEM_TYPES);
    return `buf(${result})`;
  } else {
    importsInBindingsFile.set("ptr", SYSTEM_TYPES);
    return `ptr(${result})`;
  }
};

export const renderFunctionReturnType = (
  dependencies: Set<string>,
  importsInBindingsFile: ImportMap,
  resultType: null | TypeEntry,
  parameterStrings: string[],
) => {
  const result = renderTypeAsFfi(
    dependencies,
    importsInBindingsFile,
    resultType,
  );
  if (!isPassableByValue(resultType)) {
    importsInBindingsFile.set("buf", SYSTEM_TYPES);
    parameterStrings.unshift(`buf(${result})`);
    return `"void"`;
  }
  return result;
};
