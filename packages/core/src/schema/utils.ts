import { Column, EnumColumn, ReferenceColumn, VirtualColumn } from "./types";

/**
 * Returns the name of the entity that was referenced by a reference column
 */
export const referencedEntityName = (references: unknown) =>
  (references as string).split(".")[0];

/**
 * Removed the ending from a reference column name
 */
export const stripId = <T extends string>(columnName: `${T}Id`): T =>
  columnName.slice(0, -2) as T;

export const isVirtualColumn = (column: Column): column is VirtualColumn =>
  "_type" in column && column._type === "v";

export const isEnumColumn = (column: Column): column is EnumColumn =>
  "_type" in column && column._type === "e";

export const isReferenceColumn = (column: Column): column is ReferenceColumn =>
  "references" in column && column.references !== undefined;
