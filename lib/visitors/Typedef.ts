import { Context } from "../Context.ts";
import { TypedefEntry } from "../types.d.ts";
import { visitType } from "./Type.ts";

export const visitTypedef = (
  context: Context,
  name: string,
): TypedefEntry => {
  const typedefs = context.getTypedefs();
  const found = typedefs.find((entry) => entry.nsName === name) ||
    typedefs.find((entry) => entry.name === name);
  if (!found) {
    throw new Error(`Could not find typedef '${name}'`);
  }
  found.used = true;
  if (found.target === null) {
    const referredType = found.cursor
      .getTypedefDeclarationOfUnderlyingType();
    if (!referredType) {
      throw new Error(`Could not find referred type for typedef '${name}'`);
    }
    const result = visitType(context, referredType);
    found.target = result;
  }
  return found;
};
