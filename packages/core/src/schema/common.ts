export type Scalar = "string" | "int" | "float" | "boolean" | "hex" | "bigint";
export type ID = "string" | "int" | "bigint" | "hex";

export type ScalarColumn<
  scalar extends Scalar = Scalar,
  optional extends boolean = boolean,
  list extends boolean = boolean,
> = {
  " type": "scalar";
  " scalar": scalar;
  " optional": optional;
  " list": list;
};

export type IdColumn<id extends ID = ID> = ScalarColumn<id, false, false>;

export type ReferenceColumn<
  scalar extends Scalar = Scalar,
  optional extends boolean = boolean,
  reference extends string = string,
> = {
  " type": "reference";
  " scalar": scalar;
  " optional": optional;
  " reference": reference;
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
> = {
  " type": "enum";
  " enum": _enum;
  " optional": optional;
  " list": list;
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
  | OneColumn
  | ManyColumn
  | EnumColumn;

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

export type Schema = { [name: string]: readonly [Table, Constraints] | Enum };

export type ExtractTableNames<
  schema extends Schema | unknown,
  ///
  names = keyof schema & string,
> = names extends names
  ? schema[names & keyof schema] extends readonly [Table, Constraints]
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
  tableAndConstraints extends readonly [Table, Constraints] | unknown,
  ///
  table = tableAndConstraints extends readonly [Table, Constraints]
    ? tableAndConstraints[0]
    : Table,
  columnNames = keyof table & string,
> = columnNames extends columnNames
  ? table[columnNames & keyof table] extends
      | ScalarColumn
      | ReferenceColumn
      | EnumColumn
    ? table[columnNames & keyof table][" optional"] extends true
      ? columnNames
      : never
    : never
  : never;

export type ExtractRequiredColumnNames<
  tableAndConstraints extends readonly [Table, Constraints] | unknown,
  ///
  table = tableAndConstraints extends readonly [Table, Constraints]
    ? tableAndConstraints[0]
    : Table,
  columnNames = keyof table & string,
> = columnNames extends columnNames
  ? table[columnNames & keyof table] extends
      | ScalarColumn
      | ReferenceColumn
      | EnumColumn
    ? table[columnNames & keyof table][" optional"] extends false
      ? columnNames
      : never
    : never
  : never;

export type ExtractReferenceColumnNames<
  tableAndConstraints extends readonly [Table, Constraints] | unknown,
  referenceTable extends string = string,
  ///
  table = tableAndConstraints extends readonly [Table, Constraints]
    ? tableAndConstraints[0]
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
    ? columnNames
    : never
  : never;
