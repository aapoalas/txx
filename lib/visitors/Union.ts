import { CXCursor } from "https://deno.land/x/libclang@1.0.0-beta.8/mod.ts";
import { Context } from "../Context.ts";
import { InlineUnionTypeEntry } from "../types.d.ts";
import {
  CXChildVisitResult,
  CXCursorKind,
} from "https://deno.land/x/libclang@1.0.0-beta.8/include/typeDefinitions.ts";
import { visitType } from "./Type.ts";

export const visitUnionCursor = (context: Context, cursor: CXCursor) => {
  const entry = context.findUnionByCursor(cursor);
  if (!entry) {
    throw new Error("Could not find union");
  }

  if (entry.used) {
    return entry;
  }

  entry.cursor.visitChildren((child) => {
    if (child.kind === CXCursorKind.CXCursor_FieldDecl) {
      const typeEntry = visitType(context, child.getType()!);
      if (!typeEntry) {
        throw new Error("Failed to visit union field");
      }
      entry.fields.push(typeEntry);
    }
    return CXChildVisitResult.CXChildVisit_Continue;
  });

  entry.used = true;

  return entry;
};
