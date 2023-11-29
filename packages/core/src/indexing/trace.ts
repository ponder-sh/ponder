import { readFileSync } from "node:fs";

import { codeFrameColumns } from "@babel/code-frame";
import { parse as parseStackTrace, type StackFrame } from "stacktrace-parser";

import type { Options } from "@/config/options.js";

export const getStackTrace = (error: Error, options: Options) => {
  if (!error.stack) return undefined;

  const stackTrace = parseStackTrace(error.stack);

  let codeFrame: string | undefined;
  let userStackTrace: StackFrame[];

  // Find first frame that occurred within user code.
  const firstUserFrameIndex = stackTrace.findIndex(
    (frame) => frame.file?.includes(options.srcDir),
  );

  if (firstUserFrameIndex >= 0) {
    userStackTrace = stackTrace.filter((_, idx) => idx >= firstUserFrameIndex);

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
    ...userStackTrace.map((frame) => {
      let result = "  at";

      result += ` ${
        frame.methodName === "<unknown>" ? "(anonymous)" : frame.methodName
      }`;

      result += ` (${frame.file}:${frame.lineNumber}${
        frame.column !== null ? `:${frame.column}` : ""
      })`;

      return result;
    }),
    codeFrame,
  ].join("\n");

  return formattedStackTrace;
};
