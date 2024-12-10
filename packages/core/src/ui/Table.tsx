import { Box, Text, render } from "ink"; // Assuming you're using ink for CLI UI components
import React from "react";

const MAX_COLUMN_WIDTH = 24;

export function Table<TRow extends { [key: string]: any }>(props: {
  columns: {
    title: string;
    key: keyof TRow;
    align: "left" | "right";
    format?: (value: any, row: TRow) => string | number | React.JSX.Element;
  }[];
  rows: TRow[];
}) {
  const { columns, rows } = props;

  const formattedRows = rows.map((row) =>
    columns.reduce(
      (acc, column) => ({
        ...acc,
        [column.key.toString()]: column.format
          ? column.format(row[column.key], row)
          : row[column.key],
      }),
      {} as TRow,
    ),
  );

  const columnWidths = columns.map((column) => {
    let maxWidth = Math.max(
      ...formattedRows.map((row) =>
        row[column.key] !== undefined ? row[column.key].toString().length : 9,
      ),
      column.title.length,
    );
    maxWidth = Math.min(maxWidth, MAX_COLUMN_WIDTH);
    return maxWidth;
  });

  return (
    <Box flexDirection="column">
      {/* Top Line */}
      {/* <Box flexDirection="row" key="top">
        <Text>┌</Text>
        {columnWidths.map((width, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: <explanation>
          <Text key={index}>
            {"─".repeat(width + 2)}
            {index < columns.length - 1 ? "┬" : "┐"}
          </Text>
        ))}
      </Box> */}

      {/* Column Titles */}
      <Box flexDirection="row" key="title">
        {columns.map(({ title }, index) => (
          <React.Fragment key={`title-${title}`}>
            <Text>│</Text>
            <Box
              width={columnWidths[index]}
              justifyContent="flex-start"
              marginX={1}
            >
              <Text bold wrap="truncate-end">
                {title}
              </Text>
            </Box>
          </React.Fragment>
        ))}
        <Text>│</Text>
      </Box>

      {/* Separator Line */}
      <Box flexDirection="row" key="separator">
        <Text>├</Text>
        {columnWidths.map((width, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: <explanation>
          <Text key={index}>
            {"─".repeat(width + 2)}
            {index < columns.length - 1 ? "┼" : "┤"}
          </Text>
        ))}
      </Box>

      {/* Rows of Data */}
      {formattedRows.map((row, rowIndex) => (
        <Box
          flexDirection="row"
          // biome-ignore lint/suspicious/noArrayIndexKey: <explanation>
          key={rowIndex}
        >
          {columns.map(({ key, align }, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: <explanation>
            <React.Fragment key={index}>
              <Text>│</Text>
              <Box
                width={columnWidths[index]}
                justifyContent={align === "left" ? "flex-start" : "flex-end"}
                marginX={1}
              >
                <Text wrap="truncate-end">{row[key]}</Text>
              </Box>
            </React.Fragment>
          ))}
          <Text>│</Text>
        </Box>
      ))}

      {/* Bottom Line */}
      {/* <Box flexDirection="row" key="bottom">
        <Text>└</Text>
        {columnWidths.map((width, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: <explanation>
          <Text key={index}>
            {"─".repeat(width + 2)}
            {index < columns.length - 1 ? "┴" : "┘"}
          </Text>
        ))}
      </Box> */}
    </Box>
  );
}

export function printTable<TRow extends { [key: string]: any }>(props: {
  columns: {
    title: string;
    key: keyof TRow;
    align: "left" | "right";
    format?: (value: any, row: TRow) => string | number | React.JSX.Element;
  }[];
  rows: TRow[];
}) {
  const table = (
    <>
      <Text> </Text>
      <Table {...props} />
      <Text> </Text>
    </>
  );
  const instance = render(table);
  instance.cleanup();
}
