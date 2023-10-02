/**
 * Scalars
 */
export const string = { optional: false, data: "string" } as const;
export const number = { optional: false, data: "number" } as const;
export const boolean = { optional: false, data: "boolean" as const };
export const bytes = { optional: false, data: "bytes" as const };
export const bigint = { optional: false, data: "bigint" as const };

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
 */
type List = {
  type: "list";
  data: Scalar;
};

/**
 * SQL Schema types
 */
type Column = {
  optional: boolean;
  data: Scalar | List;
};

type Table = {
  name: string;
  columns: { id: ID } & Record<string, Column | Table>;
};

/**
 * changes a column to optional
 */
export const optional = <TColumn extends Column>(column: TColumn): TColumn => ({
  ...column,
  optional: true,
});

/**
 * creates a list from a scalar
 */
export const list = (scalar: { optional: false; data: Scalar }): Column => ({
  optional: false,
  data: {
    type: "list",
    data: scalar.data,
  },
});

/**
 * Create a schema from a typescript definition
 *
 * This might not have to do anything and just be used for type inference
 */
export const createSchema = (tables: Table[]) => tables;

export const createTable = <TTableName extends string>(
  name: TTableName,
  columns: { id: ID } & Record<string, Column | Table>
): Table => ({ name, columns });
