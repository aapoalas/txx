import { CXCursor } from "https://deno.land/x/libclang@1.0.0-beta.8/mod.ts";
import { Context } from "../Context.ts";
import type { Parameter, TypeEntry } from "../types.d.ts";
import {
  isInlineTemplateStruct,
  isPassableByValue,
  isPointer,
  isStruct,
} from "../utils.ts";
import { markClassUsedAsBufferOrPointer } from "./Class.ts";
import { markTemplateInstanceUsedAsBufferOrPointer } from "./ClassTemplate.ts";
import { visitType } from "./Type.ts";
import { CXCursorKind } from "https://deno.land/x/libclang@1.0.0-beta.8/include/typeDefinitions.ts";

export const visitFunctionCursor = (
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
    let defaultValue: undefined | null | CXCursor;
    arg.visitChildren((paramchild) => {
      if (paramchild.kind === CXCursorKind.CXCursor_DeclRefExpr) {
        defaultValue = paramchild;
      } else if (
        paramchild.kind === CXCursorKind.CXCursor_CXXNullPtrLiteralExpr
      ) {
        defaultValue = null;
      }
      return 2;
    });
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

    if (isStruct(type) && !isPassableByValue(type)) {
      // Pass-by-value struct as a parameter only accepts Uint8Arrays in Deno.
      markClassUsedAsBufferOrPointer(type, true);
    } else if (isInlineTemplateStruct(type) && !isPassableByValue(type)) {
      if (!type.specialization) {
        type.specialization = type.template.defaultSpecialization!;
      }
      markTemplateInstanceUsedAsBufferOrPointer(type, true);
    }

    parameters.push({
      kind: "parameter",
      comment: null,
      name,
      type,
      defaultValue,
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
      // By-value struct returns as a Uint8Array,
      // by-ref struct takes an extra Uint8Array parameter.
      // Either way, the struct ends up as a buffer.
      markClassUsedAsBufferOrPointer(result, true);
    } else if (isInlineTemplateStruct(result)) {
      // Same thing as above: One way or another the template
      // instance struct ends up as a buffer.
      if (!result.specialization) {
        result.specialization = result.template.defaultSpecialization!;
      }
      markTemplateInstanceUsedAsBufferOrPointer(result, true);
    } else if (isPointer(result)) {
      if (isStruct(result.pointee)) {
        markClassUsedAsBufferOrPointer(result.pointee, false);
      } else if (isInlineTemplateStruct(result.pointee)) {
        if (!result.pointee.specialization) {
          result.pointee.specialization = result.pointee.template
            .defaultSpecialization!;
        }
        markTemplateInstanceUsedAsBufferOrPointer(result.pointee, false);
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
