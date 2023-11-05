import { codeFrameColumns } from "@babel/code-frame";
import { readFileSync } from "node:fs";
import { parse as parseStackTrace } from "stacktrace-parser";

export function getPrettyStackTrace(error: Error) {
  if (!error.stack) return undefined;
  const stackTrace = parseStackTrace(error.stack);

  const prettyFrames = [];
  let codeFrame: string | undefined = undefined;

  for (const stackFrame of stackTrace) {
    if (stackFrame.methodName === "ViteNodeRunner.runModule") break;

    prettyFrames.push(stackFrame);

    // Iterate through stack frames until we're able to generate code frame.
    const { file, lineNumber, column } = stackFrame;
    if (codeFrame === undefined && file !== null && lineNumber !== null) {
      try {
        const sourceFileContents = readFileSync(file, { encoding: "utf-8" });

        codeFrame = codeFrameColumns(
          sourceFileContents,
          { start: { line: lineNumber, column: column ?? undefined } },
          { highlightCode: true }
        );
      } catch (err) {
        // No-op.
      }
    }
  }

  const prettyStackTrace = [
    ...prettyFrames.map((frame) => {
      const prefix = `    at`;
      const path = `${frame.file}${
        frame.lineNumber !== null ? `:${frame.lineNumber}` : ""
      }${frame.column !== null ? `:${frame.column}` : ""}`;

      if (frame.methodName === "<unknown>") {
        return `${prefix} ${path}`;
      } else {
        return `${prefix} ${frame.methodName} (${path})`;
      }
    }),
    codeFrame,
  ].join("\n");

  return prettyStackTrace;
}
