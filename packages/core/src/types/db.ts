import type { OnchainTable, PrimaryKeyBuilder } from "@/drizzle/db.js";
import type { Drizzle, Schema, onchain } from "@/drizzle/index.js";
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
  sql: Drizzle<schema>;
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

export type IsSerialPrimaryKey<
  table extends Table,
  ///
  primaryKey extends keyof table["_"]["columns"] = InferPrimaryKey<table>,
> = table["_"]["columns"][primaryKey]["columnType"] extends "PgSerial"
  ? true
  : false;

export type Find = <table extends Table>(
  table: table extends { [onchain]: true }
    ? table
    : PonderTypeError<`db.find() can only be used with onchain tables, and '${table["_"]["name"]}' is an offchain table.`>,
  key: Key<table>,
) => Promise<InferSelectModel<table> | undefined>;

export type Insert = <table extends Table>(
  table: table extends { [onchain]: true }
    ? table
    : PonderTypeError<`Indexing functions can only write to onchain tables, and '${table["_"]["name"]}' is an offchain table.`>,
) => {
  values: (
    values: InferInsertModel<table> | InferInsertModel<table>[],
  ) => Promise<void>;
};

export type Update = <table extends Table>(
  table: table extends { [onchain]: true }
    ? table
    : PonderTypeError<`Indexing functions can only write to onchain tables, and '${table["_"]["name"]}' is an offchain table.`>,
  key: Key<table>,
) => {
  set: (
    values:
      | Partial<InferInsertModel<table>>
      | ((row: InferSelectModel<table>) => Partial<InferInsertModel<table>>),
  ) => Promise<void>;
};

export type Upsert = <
  table extends Table,
  ///
  insertModel = InferInsertModel<table>,
  selectModel = InferSelectModel<table>,
  insertValues = Prettify<Omit<insertModel, InferPrimaryKey<table>>>,
  updateFn = (row: selectModel) => Partial<insertModel>,
>(
  table: table extends { [onchain]: true }
    ? table
    : PonderTypeError<`Indexing functions can only write to onchain tables, and '${table["_"]["name"]}' is an offchain table.`>,
  key: Key<table>,
) => {
  /** Insert a row */
  insert: (values: insertValues) => {
    /** Update the existing row */
    update: (values: Partial<insertModel> | updateFn) => Promise<void>;
  } & Promise<void>;
  /** Update the existing row */
  update: (values: Partial<insertModel> | updateFn) => {
    /** Insert a row */
    insert: (values: insertValues) => Promise<void>;
  } & Promise<void>;
};

export type Delete = <table extends Table>(
  table: table extends { [onchain]: true }
    ? table
    : PonderTypeError<`Indexing functions can only write to onchain tables, and '${table["_"]["name"]}' is an offchain table.`>,
  key: Key<table>,
) => Promise<void>;
