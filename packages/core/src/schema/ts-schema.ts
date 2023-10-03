/**
 * Scalars
 */
export const string = { optional: false, data: "string" } as const;
export const number = { optional: false, data: "number" } as const;
export const boolean = { optional: false, data: "boolean" } as const;
export const bytes = { optional: false, data: "bytes" } as const;
export const bigint = { optional: false, data: "bigint" } as const;

type bytes = `0x${string}`;

type Scalar = (
  | typeof string
  | typeof number
  | typeof boolean
  | typeof bytes
  | typeof bigint
)["data"];

/**
 * ID must be a certain, required scalar
 */
type ID = typeof string | typeof number | typeof bytes | typeof bigint;

/**
 * Lists are arrays of data, all the same type
 *
 * Elements of a list cannot be optional
 */
type List<TData extends Scalar | unknown = unknown> = {
  type: "list";
  data: TData;
};

/**
 * SQL Schema types
 */
type Column<
  TData extends Scalar | List | unknown = unknown,
  TOptional extends boolean | unknown = unknown
> = {
  optional: TOptional;
  data: TData;
};

type Table<
  TName extends string | unknown = unknown,
  TColumns extends
    | ({ id: ID } & Record<string, Column | Table>)
    | unknown = unknown
> = {
  name: TName;
  columns: TColumns;
};

/**
 * changes a column to optional
 */
export const optional = <TColumn extends Column>(
  column: TColumn
): Column<TColumn["data"], true> => ({
  ...column,
  optional: true,
});

/**
 * creates a list from a scalar
 *
 * Lists are default false
 */
export const list = <TColumn extends Column>(
  column: TColumn
): Column<List<TColumn["data"]>, false> => ({
  optional: false,
  data: {
    type: "list",
    data: column.data,
  },
});

/**
 * Create a schema from a typescript definition
 *
 * This might not have to do anything and just be used for type inference
 */
export const createSchema = <TTables extends Table[]>(tables: TTables) =>
  tables;

export const createTable = <
  TName extends string,
  TColumns extends { id: ID } & Record<string, Column | Table>
>(
  name: TName,
  columns: TColumns
): Table<TName, TColumns> => ({ name, columns });

export type RecoverScalarType<TScalar extends Scalar> = TScalar extends "string"
  ? string
  : TScalar extends "number"
  ? number
  : TScalar extends "boolean"
  ? boolean
  : TScalar extends "bytes"
  ? bytes
  : TScalar extends "bigint"
  ? bigint
  : never;

export type TableNames<TTables extends readonly Table[]> = {
  [key in keyof TTables]: TTables[key]["name"];
};

export type TNamedEntity<TTable extends Table> = TTable extends {
  name: infer TName extends string;
}
  ? Record<TName, {}>
  : never;

export type RecoverIDType<TTable extends Table> = TTable extends {
  columns: { id: infer ID extends { data: Scalar } };
}
  ? RecoverScalarType<ID["data"]>
  : never;

export type RecoverOptionalType<
  TColumn extends Column,
  TKey extends string,
  TData
> = TColumn["optional"] extends false
  ? Record<TKey, TData>
  : Partial<Record<TKey, TData>>;

export type RecoverListType<TList extends List> = TList extends {
  data: infer Data extends Scalar;
}
  ? RecoverScalarType<Data>[]
  : never;

export type RecoverColumnType<TColumn extends Column> = TColumn extends {
  data: infer _list extends List;
}
  ? RecoverListType<_list>
  : TColumn extends {
      data: infer _scalar extends Scalar;
    }
  ? RecoverScalarType<_scalar>
  : never;
