import type { Hex } from "viem";

export type ID = "string" | "int" | "bigint" | "hex";
export type Scalar = ID | "float" | "boolean";

export type ScalarType = {
  string: string;
  int: number;
  float: number;
  boolean: boolean;
  hex: Hex;
  bigint: bigint;
};

export type DefaultValue<T extends Scalar> = ScalarType[T];

export type ScalarColumn<
  scalar extends Scalar = Scalar,
  optional extends boolean = boolean,
  list extends boolean = boolean,
  _default extends optional extends false
    ? scalar | undefined
    : scalar | null | undefined = optional extends false
    ? scalar | undefined
    : scalar | null | undefined,
> = {
  " type": "scalar";
  " scalar": scalar;
  " optional": optional;
  " list": list;
  " default": _default;
};

export type IdColumn<id extends ID = ID> = ScalarColumn<id, false, false>;

export type ReferenceColumn<
  scalar extends Scalar = Scalar,
  optional extends boolean = boolean,
  reference extends string = string,
  _default extends optional extends false
    ? scalar | undefined
    : scalar | null | undefined = optional extends false
    ? scalar | undefined
    : scalar | null | undefined,
> = {
  " type": "reference";
  " scalar": scalar;
  " optional": optional;
  " reference": reference;
  " default": _default;
};

export type JSONColumn<
  type = any,
  optional extends boolean = boolean,
  _default extends optional extends false
    ? type | undefined
    : type | null | undefined = optional extends false
    ? type | undefined
    : type | null | undefined,
> = {
  " type": "json";
  " json": type;
  " optional": optional;
  " default": _default;
};

export type OneColumn<reference extends string = string> = {
  " type": "one";
  " reference": reference;
};

export type ManyColumn<
  referenceTable extends string = string,
  referenceColumn extends string = string,
> = {
  " type": "many";
  " referenceTable": referenceTable;
  " referenceColumn": referenceColumn;
};

export type EnumColumn<
  _enum extends string = string,
  optional extends boolean = boolean,
  list extends boolean = boolean,
  _default extends optional extends false
    ? _enum | undefined
    : _enum | null | undefined = optional extends false
    ? _enum | undefined
    : _enum | null | undefined,
> = {
  " type": "enum";
  " enum": _enum;
  " optional": optional;
  " list": list;
  " default": _default;
};

export type Index<
  column extends string | readonly string[] = string | readonly string[],
  order extends "asc" | "desc" | undefined = "asc" | "desc" | undefined,
  nulls extends "first" | "last" | undefined = "first" | "last" | undefined,
> = {
  " type": "index";
  " column": column;
  " order": order;
  " nulls": nulls;
};

export type Column =
  | ScalarColumn
  | ReferenceColumn
  | JSONColumn
  | OneColumn
  | ManyColumn
  | EnumColumn;

export type MaterialColumn = Exclude<Column, OneColumn | ManyColumn>;

export type Table = { id: IdColumn } & {
  [columnName: string]: Column;
};

export type Enum = readonly string[];

export type Constraints = {
  [name: string]: Index;
};

export type IsTable<a extends Table | Enum> = a extends readonly unknown[]
  ? false
  : true;

export type Schema = {
  [name: string]: { table: Table; constraints: Constraints } | Enum;
};

export type ExtractTableNames<
  schema extends Schema | unknown,
  ///
  names = keyof schema & string,
> = names extends names
  ? schema[names & keyof schema] extends {
      table: Table;
      constraints: Constraints;
    }
    ? names
    : never
  : never;

export type ExtractEnumNames<
  schema extends Schema | unknown,
  ///
  names = keyof schema & string,
> = names extends names
  ? schema[names & keyof schema] extends Enum
    ? names
    : never
  : never;

export type ExtractOptionalColumnNames<
  tableAndConstraints extends
    | { table: Table; constraints: Constraints }
    | unknown,
  ///
  table = tableAndConstraints extends { table: Table; constraints: Constraints }
    ? tableAndConstraints["table"]
    : Table,
  columnNames = keyof table & string,
> = columnNames extends columnNames
  ? table[columnNames & keyof table] extends
      | ScalarColumn
      | ReferenceColumn
      | JSONColumn
      | EnumColumn
    ? table[columnNames & keyof table][" optional"] extends true
      ? columnNames
      : never
    : never
  : never;

export type ExtractRequiredColumnNames<
  tableAndConstraints extends
    | { table: Table; constraints: Constraints }
    | unknown,
  ///
  table = tableAndConstraints extends { table: Table; constraints: Constraints }
    ? tableAndConstraints["table"]
    : Table,
  columnNames = keyof table & string,
> = columnNames extends columnNames
  ? table[columnNames & keyof table] extends
      | ScalarColumn
      | ReferenceColumn
      | JSONColumn
      | EnumColumn
    ? table[columnNames & keyof table][" optional"] extends false
      ? columnNames
      : never
    : never
  : never;

export type ExtractReferenceColumnNames<
  tableAndConstraints extends
    | { table: Table; constraints: Constraints }
    | unknown,
  referenceTable extends string = string,
  ///
  table = tableAndConstraints extends { table: Table; constraints: Constraints }
    ? tableAndConstraints["table"]
    : Table,
  columnNames = keyof table & string,
> = columnNames extends columnNames
  ? table[columnNames & keyof table] extends ReferenceColumn<
      Scalar,
      boolean,
      `${referenceTable}.id`
    >
    ? columnNames
    : never
  : never;

export type ExtractNonVirtualColumnNames<
  table extends Table | unknown,
  ///
  columnNames = keyof table & string,
> = columnNames extends columnNames
  ? table[columnNames & keyof table] extends
      | ReferenceColumn
      | ScalarColumn
      | EnumColumn
      | JSONColumn
    ? columnNames
    : never
  : never;

export type DefaultColumn =
  | ScalarColumn
  | JSONColumn
  | EnumColumn
  | ReferenceColumn;
