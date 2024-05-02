import type {
  Column,
  EnumColumn,
  ManyColumn,
  OneColumn,
  ReferenceColumn,
  ScalarColumn,
} from "./common.js";

export const isScalarColumn = (column: Column): column is ScalarColumn =>
  column[" type"] === "scalar";

export const isReferenceColumn = (column: Column): column is ReferenceColumn =>
  column[" type"] === "reference";

export const isOneColumn = (column: Column): column is OneColumn =>
  column[" type"] === "one";

export const isManyColumn = (column: Column): column is ManyColumn =>
  column[" type"] === "many";

export const isEnumColumn = (column: Column): column is EnumColumn =>
  column[" type"] === "enum";
