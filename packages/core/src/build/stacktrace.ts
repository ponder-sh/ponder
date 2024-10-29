import { readFileSync } from "node:fs";
import { codeFrameColumns } from "@babel/code-frame";
import { parse as parseStackTrace } from "stacktrace-parser";

class ESBuildTransformError extends Error {
  override name = "ESBuildTransformError";
}

class ESBuildBuildError extends Error {
  override name = "ESBuildBuildError";
}

class ESBuildContextError extends Error {
  override name = "ESBuildContextError";
}

type ViteNodeError =
  | ESBuildTransformError
  | ESBuildBuildError
  | ESBuildContextError
  | Error;

export function parseViteNodeError(file: string, error: Error): ViteNodeError {
  let resolvedError: ViteNodeError;

  if (/^(Transform failed|Build failed|Context failed)/.test(error.message)) {
    // Handle ESBuild errors based on this error message construction logic:
    // https://github.com/evanw/esbuild/blob/4e11b50fe3178ed0a78c077df78788d66304d379/lib/shared/common.ts#L1659
    const errorKind = error.message.split(" with ")[0] as
      | "Transform failed"
      | "Build failed"
      | "Context failed";
    const innerError = error.message
      .split("\n")
      .slice(1)
      .map((message) => {
        let location: string | undefined = undefined;
        let detail: string | undefined = undefined;
        if (message.includes(": ERROR: ")) {
          // /path/to/file.ts:11:9: ERROR: Expected ")" but found ";"
          const s = message.split(": ERROR: ");
          location = s[0];
          detail = s[1];
        } else {
          // error: some error without a location
          detail = message.slice(7);
        }
        return { location, detail };
      })[0];

    // If we aren't able to extract an inner error, just return the original.
    if (!innerError) return error;

    resolvedError =
      errorKind === "Transform failed"
        ? new ESBuildTransformError(innerError.detail)
        : errorKind === "Build failed"
          ? new ESBuildBuildError(innerError.detail)
          : new ESBuildContextError(innerError.detail);
    if (innerError.location)
      resolvedError.stack = `    at ${innerError.location}`;
  }
  // If it's not an ESBuild error, it's a user-land vm.runModuleInContext execution error.
  // Attempt to build a user-land stack trace.
  else if (error.stack) {
    const stackFrames = parseStackTrace(error.stack);

    const userStackFrames = [];
    for (const rawStackFrame of stackFrames) {
      if (rawStackFrame.methodName.includes("ViteNodeRunner.runModule")) break;
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
  // Still a vm.runModuleInContext execution error, but no stack.
  else {
    resolvedError = error;
  }

  // Attempt to build a code frame for the top of the user stack. This works for
  // both ESBuild and vm.runModuleInContext errors.
  if (resolvedError.stack) {
    const userStackFrames = parseStackTrace(resolvedError.stack);

    let codeFrame: string | undefined = undefined;
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
        } catch (err) {
          // No-op.
        }
      }
    }

    resolvedError.stack = `${resolvedError.name}: ${resolvedError.message}\n${resolvedError.stack}`;
    if (codeFrame) resolvedError.stack += `\n${codeFrame}`;
  }

  // Finally, add a useful relative file name and verb to the error message.
  const verb =
    resolvedError.name === "ESBuildTransformError"
      ? "transforming"
      : resolvedError.name === "ESBuildBuildError" ||
          resolvedError.name === "ESBuildContextError"
        ? "building"
        : "executing";

  // This can throw with "Cannot set property message of [object Object] which has only a getter"
  try {
    resolvedError.message = `Error while ${verb} ${file}: ${resolvedError.message}`;
  } catch (e) {}

  return resolvedError;
}
