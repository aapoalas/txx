import camelCase from "https://deno.land/x/case@2.1.1/camelCase.ts";
import pascalCase from "https://deno.land/x/case@2.1.1/pascalCase.ts";
import type {
  ClassTemplateEntry,
  ClassTemplatePartialSpecialization,
  ImportMap,
  RenderData,
  TemplateParameter,
  TypeEntry,
} from "../types.d.ts";
import {
  createDummyRenderDataEntry,
  createRenderDataEntry,
  isPointer,
} from "../utils.ts";
import { renderClassBaseField, renderClassField } from "./Class.ts";
import { renderTypeAsFfi } from "./Type.ts";

export const renderClassTemplate = (
  renderData: RenderData,
  entry: ClassTemplateEntry,
) => {
  for (const specialization of entry.partialSpecializations) {
    if (!specialization.used) {
      continue;
    }
    renderSpecialization(
      renderData,
      specialization,
      entry,
    );
  }
  if (entry.defaultSpecialization?.used) {
    renderSpecialization(
      renderData,
      entry.defaultSpecialization,
      entry,
    );
  }
};

const renderSpecialization = (
  { entriesInTypesFile, entriesInClassesFile, importsInTypesFile }: RenderData,
  specialization: ClassTemplatePartialSpecialization,
  entry: ClassTemplateEntry,
) => {
  const ClassT = `${specialization.name}T`;
  if (!specialization.cursor.isDefinition()) {
    throw new Error(
      "Failed to build template class: No specialization matched",
    );
  } else if (
    specialization.bases.length === 0 &&
    specialization.virtualBases.length === 0 &&
    specialization.fields.length === 0
  ) {
    return;
  }
  const dependencies = new Set<string>();
  const replaceMap = new Map<string, string>();

  specialization.parameters.forEach((value, index) =>
    replaceMap.set(`type-parameter-0-${index}`, camelCase(value.name))
  );

  const inheritedPointers: string[] = [];
  const fields: string[] = [];
  const fieldRenderOptions = {
    dependencies,
    inheritedPointers,
    importsInTypesFile,
    replaceMap,
  };

  for (const base of specialization.bases) {
    renderClassBaseField(fieldRenderOptions, fields, base);
  }

  for (const field of specialization.fields) {
    renderClassField(fieldRenderOptions, fields, field);
  }

  for (const base of specialization.bases) {
    renderClassBaseField(fieldRenderOptions, fields, base);
  }

  if (fields.length === 0) {
    return;
  }

  if (inheritedPointers.length === 0) {
    inheritedPointers.push(`NonNullable<Deno.PointerValue>`);
  }

  const parameterObjects = generateApplicationParameters(
    entry.parameters,
    specialization.application,
  );
  const symbolStrings: string[] = [];
  parameterObjects.forEach((param) => {
    symbolStrings.push(
      `declare const ${specialization.name}__${param.TypeName}: unique symbol;`,
    );
  });
  inheritedPointers.push(
    `{ [${specialization.name}Template]: unknown; ${
      parameterObjects.map((param) =>
        `[${specialization.name}__${param.TypeName}]: ${param.TypeName};`
      ).join(
        " ",
      )
    } }`,
  );

  const bodyContents = `{
  ${
    generateDestructuring(
      parameterObjects,
      dependencies,
      importsInTypesFile,
      replaceMap,
    )
  }
  return { struct: [
    ${fields.join("\n    ")}
] } as const;
}`;

  const contents = `declare const ${specialization.name}Template: unique symbol;
${symbolStrings.join("\n")}
export type ${specialization.name}Pointer<${
    parameterObjects.map(renderPointerTemplateParameter).join(", ")
  }> = ${inheritedPointers.join(" & ")};
export const ${ClassT} = <${
    parameterObjects.map(renderStructTemplateParameter).join(", ")
  }>(
    ${parameterObjects.map(renderCallTemplateParameter).join("\n    ")}
) => ${bodyContents};
`;
  entriesInTypesFile.push(
    createRenderDataEntry([ClassT], [...dependencies], contents),
  );
  entriesInClassesFile.push(
    createDummyRenderDataEntry(
      `export class ${specialization.name}Buffer<${
        parameterObjects.map(renderBufferTemplateParameter).join(", ")
      }> extends Uint8Array {};
`,
    ),
  );
};

const generateDestructuring = (
  parameterObjects: TemplateParameterData[],
  dependencies: Set<string>,
  importsInTypesFile: ImportMap,
  replaceMap: Map<string, string>,
) => {
  if (parameterObjects.length === 0) {
    return "";
  } else if (
    parameterObjects.length === 1
  ) {
    const param = parameterObjects[0];
    const type = param.applicationType;
    if (type === null) {
      return "";
    } else if (isPointer(type) && type.pointee !== "self") {
      return `const ${
        renderTypeAsFfi(
          dependencies,
          importsInTypesFile,
          type.pointee,
          replaceMap,
        )
      } = ${param.name};`;
    } else if (
      typeof type === "object" && type
    ) {
      return `const ${
        renderTypeAsFfi(
          dependencies,
          importsInTypesFile,
          type,
          replaceMap,
        )
      } = ${param.name};`;
    }
  }
  throw new Error("Unknown template type check kind");
};

interface TemplateParameterData {
  name: string;
  TypeName: string;
  pointerExtends: null | string;
  structExtends: null | string;
  paramType: TypeEntry;
  applicationType: null | TypeEntry;
}

const generateApplicationParameters = (
  parameters: TemplateParameter[],
  application: TypeEntry[],
): TemplateParameterData[] => {
  if (application.length === 0) {
    return parameters.map((param) => ({
      name: camelCase(param.name),
      TypeName: pascalCase(param.name),
      pointerExtends: null,
      structExtends: null,
      paramType: param,
      applicationType: null,
    }));
  }
  if (parameters.length !== application.length) {
    throw new Error(
      "Unexpected: Different number of template parameters compared to applications",
    );
  }
  return parameters.map((param, index) => {
    const applicationParam = application[index];
    const TypeName = pascalCase(param.name);
    const name = camelCase(param.name);
    if (typeof applicationParam === "string") {
      return {
        name,
        TypeName,
        pointerExtends: `"${applicationParam}"`,
        structExtends: `"${applicationParam}"`,
        paramType: param,
        applicationType: applicationParam,
      };
    } else if (applicationParam.kind === "fn") {
      // TODO: Handle parameter and return value specialization
      return {
        name,
        TypeName,
        pointerExtends: "Deno.UnsafeCallbackDefinition",
        structExtends: "Deno.UnsafeCallbackDefinition",
        paramType: param,
        applicationType: applicationParam,
      };
    } else if (applicationParam.kind === "pointer") {
      return {
        name,
        TypeName,
        pointerExtends: `"pointer"`,
        structExtends: `"pointer"`,
        paramType: param,
        applicationType: applicationParam,
      };
    } else if (applicationParam.kind === "function") {
      throw new Error("Unexpected 'function' type parameter");
    }
    throw new Error("Unexpected");
  });
};

const renderPointerTemplateParameter = (param: TemplateParameterData): string =>
  param.pointerExtends
    ? `${param.TypeName} extends ${param.pointerExtends}`
    : param.TypeName;
const renderBufferTemplateParameter = (param: TemplateParameterData): string =>
  param.pointerExtends
    ? `_${param.TypeName} extends ${param.pointerExtends}`
    : `_${param.TypeName}`;
const renderStructTemplateParameter = (param: TemplateParameterData): string =>
  param.structExtends
    ? `const ${param.TypeName} extends ${param.structExtends}`
    : `const ${param.TypeName}`;
const renderCallTemplateParameter = (param: TemplateParameterData): string =>
  `${param.name}: ${param.TypeName}`;
