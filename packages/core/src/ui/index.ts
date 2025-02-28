import type { Common } from "@/internal/common.js";
import {
  getAppProgress,
  getIndexingProgress,
  getSyncProgress,
} from "@/internal/metrics.js";
import ansi from "ansi-escapes";
import terminalSize from "terminal-size";
import { buildUiLines, initialUiState } from "./app.js";

export function createUi({ common }: { common: Common }) {
  const ui = initialUiState;

  const { shutdown, write } = patchWriteStreams({
    getLines: () => buildUiLines(ui),
  });

  // Update the UI state every 100ms (independent of write rate)
  const stateUpdateInterval = setInterval(async () => {
    ui.sync = await getSyncProgress(common.metrics);
    ui.indexing = await getIndexingProgress(common.metrics);
    ui.app = await getAppProgress(common.metrics);

    if (common.options.hostname) ui.hostname = common.options.hostname;
    const port = (await common.metrics.ponder_http_server_port.get()).values[0]!
      .value;
    if (port !== 0) ui.port = port;
  }, 100);

  // Refresh the UI every 32ms
  const refreshInterval = setInterval(() => {
    write();
  }, 32);

  common.shutdown.add(() => {
    clearInterval(stateUpdateInterval);
    clearInterval(refreshInterval);
    shutdown();
  });
}

function patchWriteStreams({ getLines }: { getLines: () => string[] }) {
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;

  let isWriting = false;
  let previousLineCount = 0;

  let terminalWidth = terminalSize().columns;

  const calculateLineCount = (lines: string[]): number => {
    let count = 0;

    // For each line, calculate how many terminal lines it will occupy
    for (const line of lines) {
      // Calculate how many terminal lines this single line will take
      // Add 1 to account for potential wrapping at exact width
      count += Math.max(1, Math.ceil((line.length + 1) / terminalWidth));
    }

    return count;
  };

  // Clear previous UI and render new UI
  const clearAndWriteLines = (lines: string[]) => {
    if (isWriting) return;

    isWriting = true;

    try {
      const newLineCount = calculateLineCount(lines);
      const text = [...lines, ""].join("\n"); // Include trailing newline

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
      isWriting = false;
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
    write: () => {
      const lines = getLines();
      clearAndWriteLines(lines);
    },
    shutdown,
  };
}
