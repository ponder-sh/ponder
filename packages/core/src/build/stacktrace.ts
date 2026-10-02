import { readFileSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";
import { codeFrameColumns } from "@babel/code-frame";
import { parse as parseStackTrace } from "stacktrace-parser";

class TransformError extends Error {
  override name = "TransformError";
}

type ViteTransformError = Error & {
  plugin?: string;
  errors?: {
    message: string;
    loc?: { file?: string; line: number; column: number };
  }[];
};

export function parseViteError(file: string, error: Error): Error {
  let resolvedError: Error;

  // Vite adds `plugin` and `errors` to errors thrown by the transform pipeline.
  const transformError =
    (error as ViteTransformError).plugin !== undefined
      ? (error as ViteTransformError).errors?.[0]
      : undefined;

  if (transformError !== undefined) {
    // Handle Oxc transform errors. The first line of the message has the format:
    // [PARSE_ERROR] Unexpected token
    const detail = stripVTControlCharacters(transformError.message)
      .split("\n")[0]!
      .replace(/^\[[A-Z_]+\]\s*/, "");

    resolvedError = new TransformError(detail);
    // Note that Oxc columns are 0-based, but stack trace columns are 1-based.
    if (transformError.loc?.file) {
      const { file, line, column } = transformError.loc;
      resolvedError.stack = `    at ${file}:${line}:${column + 1}`;
    }
  }
  // If it's not a transform error, it's a user-land module execution error.
  // Attempt to build a user-land stack trace.
  else if (error.stack) {
    const stackFrames = parseStackTrace(error.stack);

    const userStackFrames = [];
    for (const rawStackFrame of stackFrames) {
      if (rawStackFrame.methodName.includes("runInlinedModule")) break;
      userStackFrames.push(rawStackFrame);
    }

    const userStack = userStackFrames
      .map(({ file, lineNumber, column, methodName }) => {
        const prefix = "    at";
        const path = `${file}${lineNumber !== null ? `:${lineNumber}` : ""}${
          column !== null ? `:${column}` : ""
        }`;
        if (methodName === null || methodName === "<unknown>") {
          return `${prefix} ${path}`;
        } else {
          return `${prefix} ${methodName} (${path})`;
        }
      })
      .join("\n");

    resolvedError = error;
    resolvedError.stack = userStack;
  }
  // Still a module execution error, but no stack.
  else {
    resolvedError = error;
  }

  // Attempt to build a code frame for the top of the user stack. This works for
  // both transform and module execution errors.
  if (resolvedError.stack) {
    const userStackFrames = parseStackTrace(resolvedError.stack);

    let codeFrame: string | undefined;
    for (const { file, lineNumber, column } of userStackFrames) {
      if (file !== null && lineNumber !== null) {
        try {
          const sourceFileContents = readFileSync(file, { encoding: "utf-8" });
          codeFrame = codeFrameColumns(
            sourceFileContents,
            { start: { line: lineNumber, column: column ?? undefined } },
            { highlightCode: true },
          );
          break;
        } catch (_err) {
          // No-op.
        }
      }
    }

    resolvedError.stack = `${resolvedError.name}: ${resolvedError.message}\n${resolvedError.stack}`;
    if (codeFrame) resolvedError.stack += `\n${codeFrame}`;
  }

  // Finally, add a useful relative file name and verb to the error message.
  const verb =
    resolvedError.name === "TransformError" ? "transforming" : "executing";

  // This can throw with "Cannot set property message of [object Object] which has only a getter"
  try {
    resolvedError.message = `Error while ${verb} ${file}: ${resolvedError.message}`;
  } catch (_e) {}

  return resolvedError;
}
