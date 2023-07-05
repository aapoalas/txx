import { CXCursor } from "https://deno.land/x/libclang@1.0.0-beta.8/mod.ts";
import { Context } from "../Context.ts";
import type { Parameter, TypeEntry } from "../types.d.ts";
import { isInlineTemplateStruct, isPointer, isStruct } from "../utils.ts";
import { visitType } from "./Type.ts";

export const visitFunction = (
  context: Context,
  cursor: CXCursor,
) => {
  const parameters: Parameter[] = [];
  const parameterCount = cursor.getNumberOfArguments();
  for (let i = 0; i < parameterCount; i++) {
    const arg = cursor.getArgument(i);
    if (!arg) {
      throw new Error(
        `Could not find argument at index ${i} of function '${cursor.getSpelling()}'`,
      );
    }
    const name = arg.getSpelling();
    const paramType = arg.getType();
    if (!paramType) {
      throw new Error(
        `Could not get argument type of argument '${name}' of function '${cursor.getSpelling()}'`,
      );
    }
    let type: TypeEntry | null;
    try {
      type = visitType(context, paramType);
    } catch (err) {
      const newError = new Error(
        `Failed to visit type of argument '${name}' of function '${cursor.getSpelling()}'`,
      );
      newError.cause = err;
      throw newError;
    }
    if (type === null) {
      throw new Error(
        `Type of argument '${name}' of function '${cursor.getSpelling()}' was void`,
      );
    }
    if (typeof type === "object" && "used" in type) {
      type.used = true;
    }
    parameters.push({
      kind: "parameter",
      comment: null,
      name,
      type,
    });
  }
  const rvType = cursor.getResultType();
  if (!rvType) {
    throw new Error(
      `Could not get return value type of function '${cursor.getSpelling()}'`,
    );
  }
  try {
    const result = visitType(context, rvType);
    if (result !== null && typeof result === "object" && "used" in result) {
      result.used = true;
    }

    if (isStruct(result)) {
      result.usedAsBuffer = true;
    } else if (isInlineTemplateStruct(result)) {
      result.specialization.usedAsBuffer = true;
    } else if (isPointer(result)) {
      if (isStruct(result.pointee)) {
        result.pointee.usedAsPointer = true;
      } else if (isInlineTemplateStruct(result.pointee)) {
        result.pointee.specialization.usedAsPointer = true;
      }
    }

    return {
      parameters,
      result,
    };
  } catch (err) {
    const newError = new Error(
      `Failed to visit return value type of '${cursor.getSpelling()}'`,
    );
    newError.cause = err;
    throw newError;
  }
};
