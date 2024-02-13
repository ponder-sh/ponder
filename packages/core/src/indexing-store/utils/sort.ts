import type { Schema } from "@/schema/types.js";
import { isBaseColumn, isEnumColumn } from "@/schema/utils.js";
import type { OrderByInput } from "../store.js";

export type OrderByConditions = [
  columnName: string,
  direction: "asc" | "desc",
][];

export function buildOrderByConditions({
  orderBy,
  table,
}: {
  orderBy: OrderByInput<any> | undefined;
  table: Schema["tables"][keyof Schema["tables"]];
}): OrderByConditions {
  if (!orderBy) {
    return [["id", "asc"]];
  }

  const conditions = Object.entries(orderBy);
  if (conditions.length > 1)
    throw new Error("Invalid sort. Cannot sort by multiple columns.");

  const [columnName, orderDirection] = conditions[0];

  // Validate column name.
  const column = table[columnName];
  if (!column) {
    throw Error(
      `Invalid sort. Column does not exist. Got '${columnName}', expected one of [${Object.keys(
        table,
      )
        .filter((key) => isBaseColumn(table[key]) || isEnumColumn(table[key]))
        .map((c) => `'${c}'`)
        .join(", ")}]`,
    );
  }
  if (column._type === "m" || column._type === "o") {
    throw Error(
      `Invalid sort. Cannot filter on virtual column '${columnName}'.`,
    );
  }

  if (orderDirection === undefined || !["asc", "desc"].includes(orderDirection))
    throw new Error(
      `Invalid sort direction. Got '${orderDirection}', expected 'asc' or 'desc'.`,
    );

  const orderByConditions: OrderByConditions = [[columnName, orderDirection]];

  // If the specified order by column is not the ID column, add the ID column
  // as a secondary using the same order to enforce a consistent sort.
  if (columnName !== "id") {
    orderByConditions.push(["id", orderDirection]);
  }

  return orderByConditions;
}
