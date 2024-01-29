import type { Row } from "../store.js";
import type { OrderByConditions } from "./sort.js";

export function encodeCursor(
  record: Row,
  orderByConditions: OrderByConditions,
) {
  const cursor = orderByConditions
    .map(([column]) => {
      // TODO: Properly convert value to an escaped string.
      const value = record[column]?.toString().replaceAll("|", "\\|");
      return `${column}:${value}`;
    })
    .join("|");

  return Buffer.from(cursor).toString("base64");
}

export function decodeCursor(
  cursor: string,
  orderByConditions: OrderByConditions,
) {
  const whereConditions = Buffer.from(cursor, "base64")
    .toString()
    .split("|")
    .map((condition, index) => {
      const delimIndex = condition.indexOf(":");
      if (delimIndex === -1) {
        throw new Error(
          "Invalid cursor. Expected a delimiter ':' between column name and value.",
        );
      }
      const column = condition.slice(0, delimIndex);
      const value = condition.slice(delimIndex + 1);
      if (column !== orderByConditions[index][0]) {
        throw new Error(
          `Invalid cursor. Expected column '${orderByConditions[index][0]}', received '${column}'.`,
        );
      }

      // TODO: Validate and convert value to the correct type.
      const decodedValue = value as string | number | bigint;

      return [column, decodedValue] as const;
    });

  if (whereConditions.length > 2) {
    throw new Error("Invalid cursor. Expected 1 or 2 conditions.");
  }

  if (whereConditions.length !== orderByConditions.length) {
    throw new Error(
      `Invalid cursor. Expected ${orderByConditions.length} conditions, received ${whereConditions.length}`,
    );
  }

  return whereConditions;
}
