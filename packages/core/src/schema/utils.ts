import type {
  EnumColumn,
  ManyColumn,
  NonReferenceColumn,
  OneColumn,
  ReferenceColumn,
} from "./types.js";

/**
 * Returns the name of the table that was referenced by a reference column
 */
export const referencedTableName = (references: unknown) =>
  (references as string).split(".")[0];

export const isOneColumn = (
  column:
    | EnumColumn
    | NonReferenceColumn
    | ReferenceColumn
    | ManyColumn
    | OneColumn,
): column is OneColumn => column._type === "o";

export const isManyColumn = (
  column:
    | EnumColumn
    | NonReferenceColumn
    | ReferenceColumn
    | ManyColumn
    | OneColumn,
): column is ManyColumn => column._type === "m";

export const isEnumColumn = (
  column:
    | EnumColumn
    | NonReferenceColumn
    | ReferenceColumn
    | ManyColumn
    | OneColumn,
): column is EnumColumn => column._type === "e";

export const isReferenceColumn = (
  column:
    | EnumColumn
    | NonReferenceColumn
    | ReferenceColumn
    | ManyColumn
    | OneColumn,
): column is ReferenceColumn =>
  column._type === "b" && column.references !== undefined;
