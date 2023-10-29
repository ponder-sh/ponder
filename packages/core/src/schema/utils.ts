import {
  EnumColumn,
  NonReferenceColumn,
  ReferenceColumn,
  VirtualColumn,
} from "./types";

/**
 * Returns the name of the entity that was referenced by a reference column
 */
export const referencedEntityName = (references: unknown) =>
  (references as string).split(".")[0];

export const isVirtualColumn = (
  column: EnumColumn | NonReferenceColumn | ReferenceColumn | VirtualColumn
): column is VirtualColumn => "_type" in column && column._type === "v";

export const isEnumColumn = (
  column: EnumColumn | NonReferenceColumn | ReferenceColumn | VirtualColumn
): column is EnumColumn => "_type" in column && column._type === "e";

export const isReferenceColumn = (
  column: EnumColumn | NonReferenceColumn | ReferenceColumn | VirtualColumn
): column is ReferenceColumn =>
  "references" in column && column.references !== undefined;
