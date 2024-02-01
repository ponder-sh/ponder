import { deserialize, serialize } from "@/utils/serialize.js";
import type { ExpressionBuilder } from "kysely";
import type { Row } from "../store.js";
import type { OrderByConditions } from "./sort.js";

export function encodeCursor(
  record: Row,
  orderByConditions: OrderByConditions,
) {
  const cursorValues = orderByConditions.map(([columnName]) => [
    columnName,
    record[columnName],
  ]);

  return Buffer.from(serialize(cursorValues)).toString("base64");
}

export function decodeCursor(
  cursor: string,
  orderByConditions: OrderByConditions,
) {
  const cursorValues = deserialize<[string, any][]>(
    Buffer.from(cursor, "base64").toString(),
  );

  // Validate cursor values against order by conditions.
  if (cursorValues.length !== orderByConditions.length) {
    throw new Error(
      `Invalid cursor. Got ${cursorValues.length}, ${orderByConditions.length} conditions`,
    );
  }

  for (const [index, [columnName]] of orderByConditions.entries()) {
    if (cursorValues[index][0] !== columnName) {
      throw new Error(
        `Invalid cursor. Got column '${cursorValues[index][0]}' at index ${index}, expected '${columnName}'.`,
      );
    }
  }

  return cursorValues;
}

export function buildCursorConditions(
  cursorValues: [string, any][],
  kind: "before" | "after",
  eb: ExpressionBuilder<any, any>,
) {
  const comparator = kind === "before" ? "<" : ">";
  const comparatorOrEquals = kind === "before" ? "<=" : ">=";

  if (cursorValues.length === 1) {
    const [columnName, value] = cursorValues[0];
    return eb.eb(columnName, comparatorOrEquals, value);
  } else if (cursorValues.length === 2) {
    const [columnName1, value1] = cursorValues[0];
    const [columnName2, value2] = cursorValues[1];

    return eb.or([
      eb.eb(columnName1, comparator, value1),
      eb.and([
        eb.eb(columnName1, "=", value1),
        eb.eb(columnName2, comparatorOrEquals, value2),
      ]),
    ]);
  } else {
    throw new Error(
      `Invalid cursor. Got ${cursorValues.length} value pairs, expected 1 or 2.`,
    );
  }
}
