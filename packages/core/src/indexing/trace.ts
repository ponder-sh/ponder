import { readFileSync } from "node:fs";
import path from "node:path";

import { codeFrameColumns } from "@babel/code-frame";
import {
  type DecodedSourceMap,
  originalPositionFor,
  sourceContentFor,
  TraceMap,
} from "@jridgewell/trace-mapping";
import type { MimeBuffer } from "data-uri-to-buffer";
import dataUriToBuffer from "data-uri-to-buffer";
import { parse as parseStackTrace, type StackFrame } from "stacktrace-parser";

import type { Options } from "@/config/options.js";

export const getStackTrace = (error: Error, options: Options) => {
  if (!error.stack) return undefined;

  const buildDir = path.join(options.ponderDir, "out");

  const stackTrace = parseStackTrace(error.stack);

  let codeFrame: string | undefined;

  const sourceMappedStackTrace = stackTrace
    .map((frame) => {
      if (!frame.file || !frame.lineNumber) return;

      const sourceMappedStackFrame = getSourceMappedStackFrame(
        frame.file,
        frame.lineNumber,
        frame.column,
      );

      // If this frame cannot be mapped to the user code build directory, skip it.
      if (!sourceMappedStackFrame) return;

      const {
        sourceFile,
        sourceLineNumber,
        sourceColumnNumber,
        sourceContent,
      } = sourceMappedStackFrame;

      // If this is the first frame within the build directory, generate the code frame.
      if (
        frame.file.includes(buildDir) &&
        codeFrame == null &&
        sourceContent !== null
      ) {
        codeFrame = codeFrameColumns(
          sourceContent,
          {
            start: {
              line: sourceLineNumber,
              column: sourceColumnNumber ?? undefined,
            },
          },
          {
            highlightCode: true,
          },
        );
      }

      return {
        ...frame,
        file: sourceFile,
        lineNumber: sourceLineNumber,
        column: sourceColumnNumber,
      } as StackFrame;
    })
    .filter((f): f is StackFrame => !!f);

  if (sourceMappedStackTrace.length === 0 || !codeFrame) {
    return undefined;
  }

  const formattedStackTrace = [
    ...sourceMappedStackTrace.map((frame) => {
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

function getSourceMappedStackFrame(
  file: string,
  lineNumber: number,
  columnNumber: number | null,
) {
  let fileContents: string;
  try {
    fileContents = readFileSync(file, { encoding: "utf-8" });
  } catch (_) {
    return null;
  }

  const sourceMap = getRawSourceMap(fileContents);
  if (!sourceMap) return null;

  const result = getSourcePositionAndContent(
    sourceMap,
    lineNumber,
    columnNumber,
  );

  const sourceFileRelative = result?.sourcePosition?.source;

  const sourceLineNumber = result?.sourcePosition?.line;
  const sourceColumnNumber = result?.sourcePosition?.column ?? null;
  const sourceContent = result?.sourceContent ?? null;

  if (!sourceFileRelative || !sourceLineNumber) return null;

  const sourceFile = path.resolve(path.dirname(file), sourceFileRelative);

  return {
    sourceFile,
    sourceLineNumber,
    sourceColumnNumber,
    sourceContent,
  };
}

function getSourceMapUrl(fileContents: string): string | null {
  const regex = /\/\/[#@] ?sourceMappingURL=([^\s'"]+)\s*$/gm;
  let match = null;
  for (;;) {
    const next = regex.exec(fileContents);
    if (next == null) {
      break;
    }
    match = next;
  }
  if (!(match && match[1])) {
    return null;
  }
  return match[1].toString();
}

function getRawSourceMap(fileContents: string): DecodedSourceMap | null {
  const sourceUrl = getSourceMapUrl(fileContents);
  if (!sourceUrl?.startsWith("data:")) {
    return null;
  }

  let buffer: MimeBuffer;
  try {
    buffer = dataUriToBuffer(sourceUrl);
  } catch (err) {
    console.error("Failed to parse source map URL:", err);
    return null;
  }

  if (buffer.type !== "application/json") {
    console.error(`Unknown source map type: ${buffer.typeFull}.`);
    return null;
  }

  try {
    return JSON.parse(buffer.toString());
  } catch {
    console.error("Failed to parse source map.");
    return null;
  }
}

function getSourcePositionAndContent(
  rawSourceMap: DecodedSourceMap,
  lineNumber: number,
  columnNumber: number | null,
) {
  const tracer = new TraceMap(rawSourceMap);

  const sourcePosition = originalPositionFor(tracer, {
    line: lineNumber,
    column: columnNumber ?? 0,
  });

  if (!sourcePosition.source) {
    return null;
  }

  const sourceContent = sourceContentFor(tracer, sourcePosition.source) ?? null;

  return {
    sourcePosition,
    sourceContent,
  };
}
