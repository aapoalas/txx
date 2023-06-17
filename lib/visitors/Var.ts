import { CXCursor } from "https://deno.land/x/libclang@1.0.0-beta.8/mod.ts";
import { Context } from "../Context.ts";

export const visitVar = (context: Context, cursor: CXCursor) => {
  throw new Error("Vars not yet supported");
};
