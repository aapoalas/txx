import { CXCursor } from "https://deno.land/x/libclang@1.0.0-beta.8/mod.ts";
import { Context } from "../Context.ts";
import { TypedefEntry } from "../types.d.ts";
import { visitType } from "./Type.ts";
import {
  isInlineTemplateStruct,
  isStruct,
  isTypedef,
  isUnion,
} from "../utils.ts";
import { markClassUsedAsBufferOrPointer } from "./Class.ts";
import { markTemplateInstanceUsedAsBufferOrPointer } from "./ClassTemplate.ts";

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

export const markTypedefUsedAsBufferOrPointer = (
  entry: TypedefEntry,
  usedAsBuffer: boolean,
): void => {
  if (isStruct(entry.target)) {
    markClassUsedAsBufferOrPointer(entry.target, usedAsBuffer);
  } else if (isInlineTemplateStruct(entry.target)) {
    markTemplateInstanceUsedAsBufferOrPointer(entry.target, usedAsBuffer);
  } else if (isUnion(entry.target)) {
    entry.target.fields.forEach((field) => {
      if (isStruct(field)) {
        markClassUsedAsBufferOrPointer(field, usedAsBuffer);
      } else if (isInlineTemplateStruct(field)) {
        markTemplateInstanceUsedAsBufferOrPointer(field, usedAsBuffer);
      } else if (isTypedef(field)) {
        markTypedefUsedAsBufferOrPointer(field, usedAsBuffer);
      }
    });
  }
};
