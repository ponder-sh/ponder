import { Box, Text } from "ink"; // Assuming you're using ink for CLI UI components
import React from "react";

const MAX_COLUMN_WIDTH = 24;

export function Table<TRow extends { [key: string]: any }>(props: {
  columns: {
    title: string;
    key: keyof TRow;
    align: "left" | "right";
    format?: (value: any, row: TRow) => string;
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
      ...formattedRows.map((row) => row[column.key].toString().length),
      column.title.length,
    );
    maxWidth = Math.min(maxWidth, MAX_COLUMN_WIDTH);
    return maxWidth;
  });

  return (
    <Box flexDirection="column">
      {/* Column Titles */}
      <Box flexDirection="row" key="title">
        {columns.map(({ title, key, align }, index) => (
          <React.Fragment key={`title-${index}`}>
            <Text>│</Text>
            <Box
              key={key.toString()}
              width={columnWidths[index]}
              justifyContent={align === "left" ? "flex-start" : "flex-end"}
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
      <Box flexDirection="row" key="border">
        <Text>├</Text>
        {columnWidths.map((width, index) => (
          <Text key={`separator-${index}`}>
            {"─".repeat(width + 2)}
            {index < columns.length - 1 ? "┼" : "┤"}
          </Text>
        ))}
      </Box>

      {/* Rows of Data */}
      {formattedRows.map((row, rowIndex) => (
        <Box flexDirection="row" key={`row-${rowIndex}`}>
          {columns.map(({ key, align }, index) => (
            <React.Fragment key={`cell-${rowIndex}-${index}`}>
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
    </Box>
  );
}

export default Table;
