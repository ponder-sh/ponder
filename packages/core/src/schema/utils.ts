import type {
  EnumColumn,
  ManyColumn,
  NonReferenceColumn,
  ReferenceColumn,
} from "./types.js";

/**
 * Returns the name of the table that was referenced by a reference column
 */
export const referencedTableName = (references: unknown) =>
  (references as string).split(".")[0];

export const isVirtualColumn = (
  column: EnumColumn | NonReferenceColumn | ReferenceColumn | ManyColumn,
): column is ManyColumn => column._type === "v";

export const isEnumColumn = (
  column: EnumColumn | NonReferenceColumn | ReferenceColumn | ManyColumn,
): column is EnumColumn => column._type === "e";

export const isReferenceColumn = (
  column: EnumColumn | NonReferenceColumn | ReferenceColumn | ManyColumn,
): column is ReferenceColumn =>
  column._type === "b" && column.references !== undefined;
