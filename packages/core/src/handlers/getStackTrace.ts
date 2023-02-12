import { codeFrameColumns } from "@babel/code-frame";
import type { MimeBuffer } from "data-uri-to-buffer";
import dataUriToBuffer from "data-uri-to-buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { RawSourceMap } from "source-map";
import { SourceMapConsumer } from "source-map";
import { parse as parseStackTrace } from "stacktrace-parser";

export const getStackTraceAndCodeFrame = async (error: Error) => {
  if (!error.stack) return null;

  const stackTrace = parseStackTrace(error.stack);

  let codeFrame: string | null = null;

  const sourceMappedStackTrace = await Promise.all(
    stackTrace.map(async (frame, index) => {
      if (!frame.file || !frame.lineNumber) return frame;

      const sourceMappedStackFrame = await getSourceMappedStackFrame(
        frame.file,
        frame.lineNumber,
        frame.column
      );

      if (!sourceMappedStackFrame) return frame;

      const {
        sourceFile,
        sourceLineNumber,
        sourceColumnNumber,
        sourceContent,
      } = sourceMappedStackFrame;

      // If this is the root frame, generate the code frame.
      if (index === 0 && sourceContent !== null) {
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
          }
        );
      }

      return {
        ...frame,
        file: sourceFile,
        lineNumber: sourceLineNumber,
        column: sourceColumnNumber,
      };
    })
  );

  const formattedStackTrace = sourceMappedStackTrace
    .map(
      (frame) =>
        `    at ${frame.methodName} (${frame.file}:${frame.lineNumber}${
          frame.column !== null ? `:${frame.column}` : ""
        })`
    )
    .join("\n");

  return { stackTrace: formattedStackTrace, codeFrame };
};

async function getSourceMappedStackFrame(
  file: string,
  lineNumber: number,
  columnNumber: number | null
) {
  let fileContents: string;
  try {
    fileContents = readFileSync(file, { encoding: "utf-8" });
  } catch (_) {
    return null;
  }

  const sourceMap = getRawSourceMap(fileContents);
  if (!sourceMap) return null;

  const result = await getSourcePositionAndContent(
    sourceMap,
    lineNumber,
    columnNumber
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

function getRawSourceMap(fileContents: string): RawSourceMap | null {
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

async function getSourcePositionAndContent(
  rawSourceMap: RawSourceMap,
  lineNumber: number,
  columnNumber: number | null
) {
  const consumer = await new SourceMapConsumer(rawSourceMap);

  try {
    const sourcePosition = consumer.originalPositionFor({
      line: lineNumber,
      column: columnNumber ?? 0,
    });

    if (!sourcePosition.source) {
      return null;
    }

    const sourceContent =
      consumer.sourceContentFor(sourcePosition.source) ?? null;

    return {
      sourcePosition,
      sourceContent,
    };
  } finally {
    consumer.destroy();
  }
}
