import {
  type BuilderEnumColumn,
  type BuilderManyColumn,
  type BuilderOneColumn,
  type BuilderScalarColumn,
  _enum,
  bigint,
  boolean,
  float,
  hex,
  int,
  many,
  one,
  string,
} from "./columns.js";
import type {
  Column,
  Enum,
  EnumColumn,
  ExtractEnumNames,
  ExtractReferenceColumnNames,
  ExtractTableNames,
  IdColumn,
  ManyColumn,
  OneColumn,
  ReferenceColumn,
  ScalarColumn,
} from "./common.js";

type GetTable<
  table,
  tableName extends string = string,
  schema = {},
  ///
  tableNames extends string = {} extends schema
    ? string
    : ExtractTableNames<schema>,
  enumNames extends string = {} extends schema
    ? string
    : ExtractEnumNames<schema>,
> = {} extends table
  ? {}
  : table extends {
        id: IdColumn;
      }
    ? {
        [columnName in keyof table]: table[columnName] extends ScalarColumn
          ? ScalarColumn
          : table[columnName] extends ReferenceColumn
            ? ReferenceColumn<
                table[columnName][" scalar"],
                table[columnName][" optional"],
                `${tableNames}.id`
              >
            : table[columnName] extends OneColumn
              ? OneColumn<Exclude<keyof table & string, columnName | "id">>
              : table[columnName] extends ManyColumn
                ? {} extends schema
                  ? ManyColumn
                  : table[columnName] extends ManyColumn<
                        Exclude<tableNames, tableName>
                      >
                    ? ManyColumn<
                        table[columnName][" referenceTable"],
                        ExtractReferenceColumnNames<
                          schema[table[columnName][" referenceTable"] &
                            keyof schema],
                          tableName
                        > &
                          string
                      >
                    : ManyColumn<Exclude<tableNames, tableName>>
                : table[columnName] extends EnumColumn
                  ? EnumColumn<enumNames>
                  : Column;
      }
    : { id: IdColumn } & {
        [columnName: string]: Column;
      };

export const createTable = <const table>(t: GetTable<table>): table =>
  t as table;

export const createEnum = <const _enum extends readonly string[]>(e: _enum) =>
  e;

const P = {
  createTable,
  string,
  bigint,
  int,
  float,
  hex,
  boolean,
  one,
  many,
  enum: _enum,
};

type P = {
  createTable: <const table>(t: GetTable<table>) => table;
  createEnum: <const _enum extends readonly string[]>(e: _enum) => _enum;
  string: () => BuilderScalarColumn<"string", false, false>;
  bigint: () => BuilderScalarColumn<"bigint", false, false>;
  int: () => BuilderScalarColumn<"int", false, false>;
  float: () => BuilderScalarColumn<"float", false, false>;
  hex: () => BuilderScalarColumn<"hex", false, false>;
  boolean: () => BuilderScalarColumn<"boolean", false, false>;
  one: <reference extends string>(
    ref: reference,
  ) => BuilderOneColumn<reference>;
  many: <referenceTable extends string, referenceColumn extends string>(
    ref: `${referenceTable}.${referenceColumn}`,
  ) => BuilderManyColumn<referenceTable, referenceColumn>;
  enum: <_enum extends string>(
    __enum: _enum,
  ) => BuilderEnumColumn<_enum, false, false>;
};

type CreateSchemaParameters<schema> = {} extends schema
  ? {}
  : {
      [tableName in keyof schema]: schema[tableName] extends Enum
        ? readonly string[]
        : GetTable<schema[tableName], tableName & string, schema>;
    };

export const createSchema = <const schema>(
  _schema: (p: P) => CreateSchemaParameters<schema>,
): schema => {
  // @ts-ignore
  return _schema(P) as schema;
};
