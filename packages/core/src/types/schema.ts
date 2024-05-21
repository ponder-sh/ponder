import type { Hex } from "viem";

export type UserId = string | number | Hex | bigint;

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
  | object
  | null
  | undefined;

export type UserRecord = {
  id: string | number | Hex | bigint;
  [columnName: string]: UserColumn;
};

export type UserTable = {
  id: string | number | Hex | bigint;
  [columnName: string]: UserColumn;
};

export type DatabaseColumn = string | number | Buffer | bigint | object | null;

export type DatabaseRecord = { [columnName: string]: DatabaseColumn };
