import {
  CXChildVisitResult,
  CXCursor,
  CXCursorKind,
  CXTypeKind,
} from "https://deno.land/x/libclang@1.0.0-beta.8/mod.ts";
import { EnumEntry, RenderData } from "../types.d.ts";
import { createRenderDataEntry } from "../utils.ts";
import { renderTypeAsFfi, renderTypeAsTS } from "./Type.ts";

interface EnumValue {
  name: string;
  value: null | string | number;
  comment: string | null;
}

export const renderEnum = ({
  entriesInTypesFile,
  importsInTypesFile,
}: RenderData, entry: EnumEntry) => {
  const dependencies = new Set<string>();
  const EnumT = renderTypeAsFfi(dependencies, importsInTypesFile, entry);
  const Enum = renderTypeAsTS(dependencies, importsInTypesFile, entry);
  const refT = renderTypeAsFfi(dependencies, importsInTypesFile, entry.type);
  entriesInTypesFile.push(
    createRenderDataEntry(
      [EnumT, Enum],
      [...dependencies],
      `export const ${EnumT} = ${refT};
export const enum ${Enum} {
  ${
        getEnumValues(entry.cursor).map((value) =>
          ` ${value.name}${value.value === null ? "" : ` = ${value.value}`},`
        ).join("\n  ")
      }
}
`,
    ),
  );
};

const getEnumValues = (
  typeDeclaration: CXCursor,
): EnumValue[] => {
  const enumType = typeDeclaration.getEnumDeclarationIntegerType()!;
  const canonicalKind = enumType.getCanonicalType().kind;
  const isUnsignedInt = canonicalKind === CXTypeKind.CXType_Bool ||
    canonicalKind === CXTypeKind.CXType_Char_U ||
    canonicalKind === CXTypeKind.CXType_UChar ||
    canonicalKind === CXTypeKind.CXType_UShort ||
    canonicalKind === CXTypeKind.CXType_UInt ||
    canonicalKind === CXTypeKind.CXType_ULong ||
    canonicalKind === CXTypeKind.CXType_ULongLong;
  const values: EnumValue[] = [];
  let previousRawComment = "";
  typeDeclaration.visitChildren((child, parent) => {
    if (child.kind === CXCursorKind.CXCursor_EnumConstantDecl) {
      const rawComment = child.getRawCommentText();
      let comment: string | null;
      if (rawComment === previousRawComment) {
        // "Inherited" comment, do not duplicate it
        comment = null;
      } else {
        previousRawComment = rawComment;
        comment = null;
      }
      values.push({
        comment,
        name: child.getSpelling(),
        value: null,
      });
      return CXChildVisitResult.CXChildVisit_Recurse;
    } else if (child.kind === CXCursorKind.CXCursor_IntegerLiteral) {
      const last = values.at(-1)!;
      last.value = Number(
        isUnsignedInt
          ? parent.getEnumConstantDeclarationUnsignedValue()
          : parent.getEnumConstantDeclarationValue(),
      );
    } else if (child.kind === CXCursorKind.CXCursor_DeclRefExpr) {
      const last = values.at(-1)!;
      last.value = child.getSpelling();
    } else {
      const last = values.at(-1)!;
      const policy = parent.getPrintingPolicy();
      policy.includeNewlines = false;
      const prettyPrintedParent = parent.getPrettyPrinted(policy);
      policy.dispose();
      const assignmentPrefix = `${last.name} = `;
      if (!prettyPrintedParent.startsWith(assignmentPrefix)) {
        last.value = Number(
          isUnsignedInt
            ? parent.getEnumConstantDeclarationUnsignedValue()
            : parent.getEnumConstantDeclarationValue(),
        );
      } else {
        last.value = prettyPrintedParent.substring(assignmentPrefix.length);
      }
      if (typeof last.value === "string" && last.value.endsWith("U")) {
        last.value = last.value.substring(0, last.value.length - 1);
      }
      if (typeof last.value === "string" && last.value.includes("::")) {
        last.value = last.value.replaceAll("::", ".");
      }
      if (
        !Number.isNaN(Number(last.value)) &&
        String(Number(last.value)) === last.value
      ) {
        last.value = Number(last.value);
      }
    }
    return CXChildVisitResult.CXChildVisit_Continue;
  });
  let maxHexadecimalLength = 0;
  if (
    values.length >= 3 &&
    values.every((value) => {
      if (typeof value.value === "string") {
        return true;
      }
      const isHexadecimalReady = typeof value.value === "number" &&
        (value.value === 0 ||
          Number.isInteger(Math.log(value.value) / Math.log(2)) ||
          value.value > 0x1000);
      if (isHexadecimalReady) {
        maxHexadecimalLength = value.value!.toString(16).length;
      }
      return isHexadecimalReady;
    }) &&
    !(values.length === 3 &&
      values.every((value) =>
        typeof value.value === "number" && value.value === (value.value & 0b11)
      ))
  ) {
    // Enum of powers of two, use hexadecimal formatting
    for (const value of values) {
      if (typeof value.value === "string") {
        continue;
      }
      value.value = `0x${
        value.value!.toString(16).padStart(maxHexadecimalLength, "0")
      }`;
    }
  }
  return values;
};
