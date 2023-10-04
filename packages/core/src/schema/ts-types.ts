import { Hex } from "viem";

export type Scalar = "string" | "number" | "boolean" | "bytes" | "bigint";
export type ID = "string" | "number" | "bytes" | "bigint";

/**
 * SQL Schema types
 */
export type Column<
  TType extends Scalar | unknown = unknown,
  TOptional extends boolean | unknown = unknown,
  TList extends boolean | unknown = unknown
> = {
  type: TType;
  optional: TOptional;
  list: TList;
};

export type Table<
  TName extends string | unknown = unknown,
  TColumns extends
    | ({ id?: Column<ID, false, false> } & { columns: Column[] })
    | unknown = unknown
> = {
  name: TName;
  columns: TColumns;
};

/**
 * Intermediate Type
 *
 * Type returned from createTable() or .addColumn() and accepted by createSchema()
 *
 * Is there something to name table so that it doesn't show up in intellisense
 */
export type IT<
  TTableName extends string | unknown = unknown,
  TColumns extends
    | ({ id?: Column<ID, false, false> } & Record<string, Column>)
    | unknown = unknown
> = {
  table: Table<TTableName, TColumns>;
  addColumn: <
    TName extends string,
    TType extends Scalar,
    TOptional extends boolean = false,
    TList extends boolean = false
  >(
    name: TName,
    type: TType,
    modifiers?: { optional?: TOptional; list?: TList }
  ) => IT<
    TTableName,
    TColumns & Record<TName, Column<TType, TOptional, TList>>
  >;
};

/**
 * Recover raw typescript types from the intermediate representation
 */

export type RecoverScalarType<TScalar extends Scalar> = TScalar extends "string"
  ? string
  : TScalar extends "number"
  ? number
  : TScalar extends "boolean"
  ? boolean
  : TScalar extends "bytes"
  ? Hex
  : TScalar extends "bigint"
  ? bigint
  : never;

export type RecoverIDType<TTable extends Table> = TTable extends {
  columns: { id: infer _id extends Column<ID, false, false> };
}
  ? RecoverScalarType<_id["type"]>
  : never;

export type RecoverColumnType<
  TName extends string,
  TColumn extends Column
> = TColumn extends {
  type: infer _type extends Scalar;
}
  ? Record<TName, RecoverScalarType<_type>>
  : never;
