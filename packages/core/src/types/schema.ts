import type { Hex } from "viem";

export type UserId = string | number | Hex | bigint;

export type UserValue =
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
  [columnName: string]: UserValue;
};

export type UserTable = {
  id: string | number | Hex | bigint;
  [columnName: string]: UserValue;
};

export type DatabaseValue = string | number | Buffer | bigint | object | null;

export type DatabaseRecord = { [columnName: string]: DatabaseValue };
