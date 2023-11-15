import type {
  EnumColumn,
  NonReferenceColumn,
  ReferenceColumn,
  VirtualColumn,
} from "./types.js";

/**
 * Returns the name of the table that was referenced by a reference column
 */
export const referencedTableName = (references: unknown) =>
  (references as string).split(".")[0];

export const isVirtualColumn = (
  column: EnumColumn | NonReferenceColumn | ReferenceColumn | VirtualColumn,
): column is VirtualColumn => column._type === "v";

export const isEnumColumn = (
  column: EnumColumn | NonReferenceColumn | ReferenceColumn | VirtualColumn,
): column is EnumColumn => column._type === "e";

export const isReferenceColumn = (
  column: EnumColumn | NonReferenceColumn | ReferenceColumn | VirtualColumn,
): column is ReferenceColumn =>
  column._type === "b" && column.references !== undefined;
