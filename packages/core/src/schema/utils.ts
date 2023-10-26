import { Column, Virtual } from "./types";

export const referencedEntityName = (references: unknown) =>
  (references as string).split(".")[0];

export const isEnumType = (type: string): type is `enum:${string}` =>
  type.length > 5 && type.slice(0, 5) === "enum:";

export const isVirtual = (column: Column | Virtual): column is Virtual =>
  "referenceTable" in column;

export const stripId = <T extends string>(columnName: `${T}Id`): T =>
  columnName.slice(0, -2) as T;
