import { StoreError } from "@/common/errors.js";
import type { Table } from "@/schema/common.js";
import {
  isEnumColumn,
  isJSONColumn,
  isManyColumn,
  isOneColumn,
  isReferenceColumn,
  isScalarColumn,
} from "@/schema/utils.js";
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
  table: Table;
}): OrderByConditions {
  if (!orderBy) {
    return [["id", "asc"]];
  }

  const conditions = Object.entries(orderBy);
  if (conditions.length > 1)
    throw new StoreError("Invalid sort. Cannot sort by multiple columns.");

  const [columnName, orderDirection] = conditions[0]!;

  // Validate column name.
  const column = table[columnName];
  if (!column) {
    throw new StoreError(
      `Invalid sort. Column does not exist. Got '${columnName}', expected one of [${Object.keys(
        table,
      )
        .filter(
          (columnName) =>
            isScalarColumn(table[columnName]!) ||
            isReferenceColumn(table[columnName]!) ||
            isEnumColumn(table[columnName]!) ||
            isJSONColumn(table[columnName]!),
        )
        .map((c) => `'${c}'`)
        .join(", ")}]`,
    );
  }
  if (isOneColumn(column) || isManyColumn(column)) {
    throw new StoreError(
      `Invalid sort. Cannot sort on virtual column '${columnName}'.`,
    );
  }

  if (isJSONColumn(column)) {
    throw new StoreError(
      `Invalid sort. Cannot sort on json column '${columnName}'.`,
    );
  }

  if (orderDirection === undefined || !["asc", "desc"].includes(orderDirection))
    throw new StoreError(
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

export function reverseOrderByConditions(orderByConditions: OrderByConditions) {
  return orderByConditions.map(([columnName, direction]) => [
    columnName,
    direction === "asc" ? "desc" : "asc",
  ]) satisfies OrderByConditions;
}
