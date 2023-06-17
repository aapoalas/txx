import { Context } from "../Context.ts";
import { EnumEntry } from "../types.d.ts";
import { visitType } from "./Type.ts";

export const visitEnum = (context: Context, name: string): EnumEntry => {
  const enums = context.getEnums();
  const found = enums.find((entry) => entry.nsName === name) ||
    enums.find((entry) => entry.name === name);
  if (!found) {
    throw new Error(`Could not find enum '${name}'`);
  }
  found.used = true;
  if (found.type === null) {
    const integerType = found.cursor.getEnumDeclarationIntegerType();
    if (!integerType) {
      throw new Error(`Could not find integer type for enum '${name}'`);
    }
    const result = visitType(context, integerType);
    if (result === null) {
      throw new Error(`Found void integer value for enum '${name}'`);
    }
    found.type = result;
  }
  return found;
};
