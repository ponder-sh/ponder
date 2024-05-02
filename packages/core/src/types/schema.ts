import type { Hex } from "viem";

export type UserIdColumn = string | number | Hex | bigint;

export type UserColumn =
  | string
  | string[]
  | number
  | number[]
  | boolean
  | boolean[]
  | Hex
  | Hex[]
  | bigint
  | bigint[]
  | null
  | undefined;

export type UserRow = {
  id: string | number | Hex | bigint;
  [columnName: string]: UserColumn;
};

export type UserTable = {
  id: string | number | Hex | bigint;
  [columnName: string]: UserColumn;
};

export type DatabaseColumn = string | number | Buffer | bigint | null;

export type DatabaseRow = { [columnName: string]: DatabaseColumn };
