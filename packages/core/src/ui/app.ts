import type {
  getAppProgress,
  getIndexingProgress,
  getSyncProgress,
} from "@/internal/metrics.js";
import { formatEta, formatPercentage } from "@/utils/format.js";
import pc from "picocolors";

export type UiState = {
  port: number;
  hostname: string;
  sync: Awaited<ReturnType<typeof getSyncProgress>>;
  indexing: Awaited<ReturnType<typeof getIndexingProgress>>;
  app: Awaited<ReturnType<typeof getAppProgress>>;
};

export const initialUiState: UiState = {
  port: 42069,
  hostname: "localhost",
  sync: [],
  indexing: {
    hasError: false,
    overall: {
      completedSeconds: 0,
      cachedSeconds: 0,
      totalSeconds: 0,
      progress: 0,
      totalEvents: 0,
    },
    events: [],
  },
  app: {
    progress: 0,
    eta: undefined,
    mode: undefined,
  },
};

const buildProgressBar = (current: number, end: number, width = 48): string => {
  const fraction = current / end;
  const count = Math.min(Math.floor(width * fraction), width);
  return "█".repeat(count) + "░".repeat(width - count);
};

export const buildTable = (
  rows: { [key: string]: any }[],
  columns: {
    title: string;
    key: string;
    align: "left" | "right" | string;
    format?: (value: any, row: { [key: string]: any }) => string | number;
    maxWidth?: number;
  }[],
): string[] => {
  if (rows.length === 0) {
    return ["Waiting to start..."];
  }

  // Calculate column widths
  const DEFAULT_MAX_COLUMN_WIDTH = 24;
  const columnWidths = columns.map((column) => {
    const formattedRows = rows.map((row) => {
      const value = column.format
        ? column.format(row[column.key], row)
        : row[column.key];
      return value !== undefined ? String(value) : "";
    });

    const maxWidth = Math.max(
      ...formattedRows.map((val) => val.toString().length),
      column.title.length,
    );
    return Math.min(maxWidth, column.maxWidth ?? DEFAULT_MAX_COLUMN_WIDTH);
  });

  // Generate header row
  const headerRow = [
    "│ ",
    columns
      .map((col, i) => {
        const width = columnWidths[i] ?? 0;
        return col.title
          .padEnd(width, " ")
          .padStart(col.align === "right" ? width : width, " ");
      })
      .join(" │ "),
    " │",
  ].join("");

  // Generate separator
  const separator = [
    "├─",
    columnWidths.map((w) => "─".repeat(w)).join("─┼─"),
    "─┤",
  ].join("");

  // Generate data rows
  const dataRows = rows.map((row) => {
    return [
      "│ ",
      columns
        .map((col, i) => {
          const width = columnWidths[i] ?? 0;
          const value = col.format
            ? col.format(row[col.key], row)
            : row[col.key];
          const strValue = value !== undefined ? String(value) : "";
          return col.align === "right"
            ? strValue.padStart(width, " ")
            : strValue.padEnd(width, " ");
        })
        .join(" │ "),
      " │",
    ].join("");
  });

  return [headerRow, separator, ...dataRows];
};

export const buildUiLines = (ui: UiState): string[] => {
  const { sync, indexing, app, port, hostname } = ui;
  const lines: string[] = [];

  lines.push("");

  if (indexing.hasError) {
    lines.push(
      pc.cyan("Resolve the error and save your changes to reload the server."),
    );
    return lines;
  }

  lines.push(pc.bold("Sync"));
  lines.push("");

  if (sync.length === 0) {
    lines.push("Waiting to start...");
  } else {
    lines.push(
      ...buildTable(sync, [
        {
          title: "Chain",
          key: "chainName",
          align: "left",
        },
        {
          title: "Status",
          key: "status",
          align: "left",
          format: (_, row) =>
            row.status === "historical"
              ? `${row.status} (${formatPercentage(row.progress)})`
              : row.status,
        },
        {
          title: "Block",
          key: "block",
          align: "right",
        },
        {
          title: "RPC (req/s)",
          key: "rps",
          align: "right",
          format: (_, row) => row.rps.toFixed(1),
        },
      ]),
    );
  }

  lines.push("");
  lines.push(pc.bold("Indexing"));
  lines.push("");

  if (indexing.events.length === 0) {
    lines.push("Waiting to start...");
  } else {
    lines.push(
      ...buildTable(indexing.events, [
        { title: "Event", key: "eventName", align: "left", maxWidth: 36 },
        { title: "Count", key: "count", align: "right" },
        {
          title: "Duration (ms)",
          key: "averageDuration",
          align: "right",
          format: (v) => (v > 0 ? (v < 0.001 ? "<0.001" : v.toFixed(3)) : "-"),
        },
      ]),
    );
  }

  lines.push("");

  let progressLabel = pc.bold("Progress");
  if (app.mode !== undefined && app.progress !== 0) {
    progressLabel += ` (${app.mode === "historical" ? pc.yellowBright("historical") : pc.greenBright("live")})`;
  }
  lines.push(progressLabel);
  lines.push("");

  const progressValue = app.mode === "realtime" ? 1 : app.progress;
  const progressBar = buildProgressBar(progressValue, 1, 48);
  let progressText = `${progressBar} ${formatPercentage(progressValue)}`;

  if (app.eta !== undefined && app.eta !== 0) {
    progressText += ` (${formatEta(app.eta * 1_000)} eta)`;
  }

  lines.push(progressText);
  lines.push("");

  lines.push(pc.bold("API functions"));
  lines.push(`Server live at http://${hostname}:${port}`);

  return lines;
};
