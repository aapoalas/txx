import { CXCursor } from "https://deno.land/x/libclang@1.0.0-beta.8/mod.ts";
import { Context } from "../Context.ts";
import { TypedefEntry } from "../types.d.ts";
import { visitType } from "./Type.ts";

export const visitTypedefEntry = (
  context: Context,
  cursor: CXCursor,
): TypedefEntry => {
  const typedefs = context.getTypedefs();
  const found = typedefs.find((entry) => entry.cursor.equals(cursor));
  if (!found) {
    throw new Error(
      `Could not find typedef by cursor '${cursor.getSpelling()}'`,
    );
  }
  found.used = true;
  if (found.target === null) {
    const referredType = found.cursor
      .getTypedefDeclarationOfUnderlyingType();
    if (!referredType) {
      throw new Error(
        `Could not find referred type for typedef '${found.nsName}'`,
      );
    }
    const result = visitType(context, referredType);
    found.target = result;
  }
  return found;
};
