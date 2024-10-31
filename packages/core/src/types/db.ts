import type { OnchainTable, PrimaryKeyBuilder } from "@/drizzle/index.js";
import type { Drizzle, Schema, onchain } from "@/drizzle/index.js";
import type { empty } from "@/indexing-store/index.js";
import type {
  Column,
  GetColumnData,
  InferInsertModel,
  InferSelectModel,
  Table,
} from "drizzle-orm";
import type { PgTableExtraConfig, TableConfig } from "drizzle-orm/pg-core";
import type { PonderTypeError, Prettify } from "./utils.js";

export type Db<schema extends Schema> = {
  /**
   * Find a row
   *
   * @example
   * ```ts twoslash
   * const result = await db.find(table, { id: 10 });
   * ```
   *
   * @param table - The table to select from.
   * @param key - The primary key.
   * @returns The row if it exists or undefined if it doesn't.
   */
  find: Find;
  /**
   * Create new rows
   *
   * @example
   * ```ts twoslash
   * await db.insert(table).values({ id: 10, name: "joe" });
   * ```
   *
   * @example
   * ```ts twoslash
   * await db.insert(table).values([
   *   { id: 10, name: "joe" },
   *   { id: 3, name: "rob" }
   * ]);
   * ```
   *
   * @param table - The table to insert into.
   */
  insert: Insert;
  /**
   * Update a row
   *
   * @example
   * ```ts twoslash
   * await db
   *   .update(table, { id: 10 })
   *   .set({ age: 19 });
   * ```
   *
   * @example
   * ```ts twoslash
   * await db
   *   .update(table, { id: 10 })
   *   .set((row) => ({ age: row.age + 3 }));
   * ```
   *
   * @param table - The table to select from.
   * @param key - The primary key.
   */
  update: Update;
  /**
   * If row exists, update, else insert
   *
   * @example
   * ```ts twoslash
   * await db
   *   .upsert(table, { id: 10 })
   *   .insert({ age: 23 })
   *   .update({ age: 64 });
   * ```
   *
   * @example
   * ```ts twoslash
   * await db
   *   .upsert(table, { id: 10 })
   *   .insert({ age: 52 })
   *   .update((row) => ({ age: row.age + 3 }));
   * ```
   *
   * @param table - The table to select from.
   * @param key - The primary key.
   */
  upsert: Upsert;
  /**
   * Delete a row
   *
   * @example
   * ```ts twoslash
   * const deleted = await db.delete(table, { id: 10 });
   * ```
   *
   * @param table - The table to select from.
   * @param key - The primary key.
   * @returns `true` if the row existed.
   */
  delete: Delete;
  /**
   * Access the raw drizzle object
   */
  sql: Prettify<Omit<Drizzle<schema>, "refreshMaterializedView" | "_">>;
};

type InferPrimaryKey<
  table extends Table,
  ///
  columns extends Record<string, Column> = table["_"]["columns"],
  columnNames extends keyof columns & string = keyof columns & string,
> = columnNames extends columnNames
  ? columns[columnNames]["_"]["isPrimaryKey"] extends true
    ? columnNames
    : never
  : never;

export type Key<
  table extends Table,
  ///
  compositePrimaryKey extends // @ts-ignore
  keyof table["_"]["columns"] = InferCompositePrimaryKey<table>,
  primaryKey extends keyof table["_"]["columns"] = [
    compositePrimaryKey,
  ] extends [never]
    ? InferPrimaryKey<table>
    : compositePrimaryKey,
> = {
  [columnName in primaryKey]: GetColumnData<table["_"]["columns"][columnName]>;
};

export type InferCompositePrimaryKey<
  table extends OnchainTable<
    TableConfig & { extra: PgTableExtraConfig | undefined }
  >,
  ///
  extra extends PgTableExtraConfig | undefined = table["_"]["config"]["extra"],
  builders = extra[keyof extra],
> = builders extends builders
  ? builders extends PrimaryKeyBuilder
    ? builders["columnNames"]
    : never
  : never;

export type InferSerialPrimaryKey<
  table extends Table,
  ///
  columns extends Record<string, Column> = table["_"]["columns"],
  primaryKey extends keyof table["_"]["columns"] = InferPrimaryKey<
    table,
    columns
  >,
> = columns[primaryKey]["_"]["columnType"] extends `${string}Serial`
  ? primaryKey
  : never;

export type Find = <
  table extends Table,
  ///
  serialPrimaryKey extends string | never = InferSerialPrimaryKey<table>,
>(
  table: table extends { [onchain]: true }
    ? [serialPrimaryKey] extends [never]
      ? table
      : PonderTypeError<`db.find() cannot be used with tables with serial primary keys, and '${table["_"]["name"]}.${serialPrimaryKey}' is a serial column.`>
    : PonderTypeError<`db.find() can only be used with onchain tables, and '${table["_"]["name"]}' is an offchain table.`>,
  key: Key<table>,
) => Promise<InferSelectModel<table> | typeof empty>;

export type Insert = <table extends Table>(
  table: table extends { [onchain]: true }
    ? table
    : PonderTypeError<`Indexing functions can only write to onchain tables, and '${table["_"]["name"]}' is an offchain table.`>,
) => {
  values: <values extends InferInsertModel<table> | InferInsertModel<table>[]>(
    values: values,
  ) => Promise<values>;
};

export type Update = <
  table extends Table,
  ///
  serialPrimaryKey extends string | never = InferSerialPrimaryKey<table>,
  insertModel = InferInsertModel<table>,
  insertValues = Prettify<Omit<insertModel, keyof Key<table>>>,
>(
  table: table extends { [onchain]: true }
    ? [serialPrimaryKey] extends [never]
      ? table
      : PonderTypeError<`db.update() cannot be used with tables with serial primary keys, and '${table["_"]["name"]}.${serialPrimaryKey}' is a serial column.`>
    : PonderTypeError<`Indexing functions can only write to onchain tables, and '${table["_"]["name"]}' is an offchain table.`>,
  key: Key<table>,
) => {
  set: (
    values:
      | Partial<insertValues>
      | ((row: insertModel) => Partial<insertValues>),
  ) => Promise<insertModel>;
};

export type Upsert = <
  table extends Table,
  ///
  serialPrimaryKey extends string | never = InferSerialPrimaryKey<table>,
  insertModel = InferInsertModel<table>,
  selectModel = InferSelectModel<table>,
  insertValues = Prettify<Omit<insertModel, keyof Key<table>>>,
  updateFn = (row: selectModel) => Partial<insertModel>,
>(
  table: table extends { [onchain]: true }
    ? [serialPrimaryKey] extends [never]
      ? table
      : PonderTypeError<`db.upsert() cannot be used with tables with serial primary keys, and '${table["_"]["name"]}.${serialPrimaryKey}' is a serial column.`>
    : PonderTypeError<`Indexing functions can only write to onchain tables, and '${table["_"]["name"]}' is an offchain table.`>,
  key: Key<table>,
) => {
  /** Insert a row */
  insert: (values: insertValues) => {
    /** Update the existing row */
    update: (
      values: Partial<insertModel> | updateFn,
    ) => Promise<InferSelectModel<table>>;
  } & Promise<InferSelectModel<table> | null>;
  /** Update the existing row */
  update: (values: Partial<insertModel> | updateFn) => {
    /** Insert a row */
    insert: (values: insertValues) => Promise<InferSelectModel<table>>;
  } & Promise<InferSelectModel<table> | null>;
};

export type Delete = <
  table extends Table,
  ///
  serialPrimaryKey extends string | never = InferSerialPrimaryKey<table>,
>(
  table: table extends { [onchain]: true }
    ? [serialPrimaryKey] extends [never]
      ? table
      : PonderTypeError<`db.delete() cannot be used with tables with serial primary keys, and '${table["_"]["name"]}.${serialPrimaryKey}' is a serial column.`>
    : PonderTypeError<`Indexing functions can only write to onchain tables, and '${table["_"]["name"]}' is an offchain table.`>,
  key: Key<table>,
) => Promise<boolean>;
