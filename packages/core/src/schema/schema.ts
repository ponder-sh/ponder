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
  index,
  int,
  many,
  one,
  string,
} from "./columns.js";
import type {
  Column,
  Constraints,
  EnumColumn,
  ExtractEnumNames,
  ExtractReferenceColumnNames,
  ExtractTableNames,
  IdColumn,
  Index,
  ManyColumn,
  OneColumn,
  ReferenceColumn,
  ScalarColumn,
  Schema,
  Table,
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

type GetConstraints<
  constraints,
  table,
  ///
  columnName extends string = keyof table & string,
> = {} extends constraints
  ? {}
  : {
      [name in keyof constraints]: Index<columnName | readonly columnName[]>;
    };

export const createTable = <const table, const constraints>(
  t: GetTable<table>,
  c?: GetConstraints<constraints, table>,
): readonly [table, constraints] => [t as table, c as constraints];

export const createEnum = <const _enum extends readonly string[]>(e: _enum) =>
  e;

const P = {
  createTable,
  createEnum,
  string,
  bigint,
  int,
  float,
  hex,
  boolean,
  one,
  many,
  enum: _enum,
  index,
};

type P = {
  createTable: <const table, const constraints>(
    t: GetTable<table>,
    c?: GetConstraints<constraints, table>,
  ) => readonly [table, constraints];
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
  index: <const column extends string | readonly string[]>(
    c: column,
  ) => Index<column>;
};

type CreateSchemaParameters<schema> = {} extends schema
  ? {}
  : {
      [tableName in keyof schema]: schema[tableName] extends readonly [
        infer table extends Table,
        infer constraints extends Constraints,
      ]
        ? readonly [
            GetTable<table, tableName & string, schema>,
            GetConstraints<constraints, table>,
          ]
        : readonly string[];
    };

export const createSchema = <const schema>(
  _schema: (p: P) => CreateSchemaParameters<schema>,
): unknown extends schema ? Schema : schema => {
  // @ts-ignore
  return _schema(P) as schema;
};
