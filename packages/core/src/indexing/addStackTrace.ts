import { readFileSync } from "node:fs";
import type { Options } from "@/common/options.js";
import { codeFrameColumns } from "@babel/code-frame";
import { type StackFrame, parse as parseStackTrace } from "stacktrace-parser";

export const addStackTrace = (error: Error, options: Options) => {
  if (!error.stack) return;

  const stackTrace = parseStackTrace(error.stack);

  let codeFrame: string | undefined;
  let userStackTrace: StackFrame[];

  // Find first frame that occurred within user code.
  const firstUserFrameIndex = stackTrace.findIndex((frame) =>
    frame.file?.includes(options.srcDir),
  );

  if (firstUserFrameIndex >= 0) {
    userStackTrace = stackTrace.filter((frame) =>
      frame.file?.includes(options.srcDir),
    );

    const firstUserFrame = stackTrace[firstUserFrameIndex];
    if (firstUserFrame?.file && firstUserFrame?.lineNumber) {
      try {
        const sourceContent = readFileSync(firstUserFrame.file, {
          encoding: "utf-8",
        });
        codeFrame = codeFrameColumns(
          sourceContent,
          {
            start: {
              line: firstUserFrame.lineNumber,
              column: firstUserFrame.column ?? undefined,
            },
          },
          { highlightCode: true },
        );
      } catch (err) {
        // Ignore errors here.
      }
    }
  } else {
    userStackTrace = stackTrace;
  }

  const formattedStackTrace = [
    `${error.name}: ${error.message}`,
    ...userStackTrace.map(({ file, lineNumber, column, methodName }) => {
      const prefix = "    at";
      const path = `${file}${lineNumber !== null ? `:${lineNumber}` : ""}${
        column !== null ? `:${column}` : ""
      }`;
      if (methodName === null || methodName === "<unknown>") {
        return `${prefix} ${path}`;
      } else {
        return `${prefix} ${methodName} (${path})`;
      }
    }),
    codeFrame,
  ].join("\n");

  error.stack = formattedStackTrace;
};
