import ansi from "ansi-escapes";
import terminalSize from "terminal-size";

export function patchWriteStreams({ getLines }: { getLines: () => string[] }) {
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;

  let isWriting = false;
  let previousLineCount = 0;

  let terminalWidth = terminalSize().columns;

  const calculateLineCount = (lines: string[]): number => {
    let count = 0;

    // For each line, calculate how many terminal lines it will occupy
    for (const line of lines) {
      // Apply wrapping logic to get actual number of lines
      const visibleLength = line.replaceAll(ansiEscapeRegex, "").length;
      count += Math.max(1, Math.ceil(visibleLength / terminalWidth));
    }

    return count;
  };

  // Clear previous UI and render new UI
  const clearAndWriteLines = (lines: string[]) => {
    if (isWriting && !lines) return;

    const wasAlreadyWriting = isWriting;
    if (!wasAlreadyWriting) isWriting = true;

    try {
      const text = [...lines, ""].join("\n"); // Include trailing newline

      // Calculate line count after constructing the text to ensure accuracy
      const newLineCount = calculateLineCount(lines);

      // Move cursor up to the start of the previous UI
      if (previousLineCount > 0) {
        originalStdoutWrite.call(
          process.stdout,
          ansi.cursorUp(previousLineCount),
        );
      }
      // Clear all lines of the previous UI and below
      originalStdoutWrite.call(process.stdout, ansi.eraseDown);
      // Write the new UI
      originalStdoutWrite.call(process.stdout, text);

      previousLineCount = newLineCount;
    } finally {
      if (!wasAlreadyWriting) isWriting = false;
    }
  };

  // Monkey patch stdout and stderr to handle out-of-band output
  const handleOutput = function (
    this: NodeJS.WriteStream,
    buffer: string | Uint8Array,
    encoding?: BufferEncoding,
    cb?: (err?: Error) => void,
  ) {
    const originalWrite =
      this === process.stderr ? originalStderrWrite : originalStdoutWrite;

    // If we're already writing, use the original to avoid recursion
    if (isWriting) {
      return originalWrite.apply(this, [buffer, encoding, cb]);
    }

    // Clear the UI
    if (previousLineCount > 0) {
      originalStdoutWrite.call(
        process.stdout,
        ansi.cursorUp(previousLineCount) + ansi.eraseDown,
      );
      previousLineCount = 0;
    }

    // Write the new content
    const result = originalWrite.apply(this, [buffer, encoding, cb]);

    // Clear and write the latest UI below the new content
    const lines = getLines();
    clearAndWriteLines(lines);

    return result;
  };
  process.stdout.write = handleOutput as typeof process.stdout.write;
  process.stderr.write = handleOutput as typeof process.stderr.write;

  // On terminal resize, reset terminal width and force a re-render
  const resizeListener = () => {
    terminalWidth = terminalSize().columns;

    // Clear the UI
    if (previousLineCount > 0) {
      originalStdoutWrite.call(
        process.stdout,
        ansi.cursorUp(previousLineCount) + ansi.eraseDown,
      );
      previousLineCount = 0;
    }

    // Clear and write the latest UI
    const lines = getLines();
    clearAndWriteLines(lines);
  };
  process.stdout.on("resize", resizeListener);

  const shutdown = () => {
    // Restore original write methods
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;

    // Clear the UI
    if (previousLineCount > 0) {
      originalStdoutWrite.call(
        process.stdout,
        ansi.cursorUp(previousLineCount) + ansi.eraseDown,
      );
    }

    // Remove resize listener
    process.stdout.removeListener("resize", resizeListener);
  };

  return {
    refresh: () => {
      const lines = getLines();
      clearAndWriteLines(lines);
    },
    shutdown,
  };
}

// Regex to strip ANSI escape sequences from a string
const ansiEscapeRegex = new RegExp(
  [
    "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
    "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))",
  ].join("|"),
  "g",
);
