import { Context } from "../Context.ts";
import { VarEntry } from "../types.d.ts";
import { visitType } from "./Type.ts";

export const visitVar = (context: Context, entry: VarEntry): void => {
  const type = visitType(context, entry.cursor.getType()!);

  entry.type = type;
  entry.used = true;
};
