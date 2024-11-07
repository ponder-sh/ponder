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
   * @example
   * ```ts twoslash
   * await db.insert(table).values({ id: 10, name: "joe" }).onConflictDoNothing();
   * ```
   *
   * @example
   * ```ts twoslash
   * await db
   *   .insert(table)
   *   .values({ id: 10, name: "joe" })
   *   .onConflictDoUpdate((row) => ({ age: row.age + 3 }));
   *
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

export type Find = <table extends Table>(
  table: table extends { [onchain]: true }
    ? table
    : PonderTypeError<`db.find() can only be used with onchain tables, and '${table["_"]["name"]}' is an offchain table.`>,
  key: Key<table>,
) => Promise<InferSelectModel<table> | typeof empty>;

export type Insert = <
  table extends Table,
  ///
  insertModel = InferInsertModel<table>,
  selectModel = InferSelectModel<table>,
  updateModel = Prettify<Omit<insertModel, keyof Key<table>>>,
  updateFn = (row: selectModel) => Partial<updateModel>,
>(
  table: table extends { [onchain]: true }
    ? table
    : PonderTypeError<`Indexing functions can only write to onchain tables, and '${table["_"]["name"]}' is an offchain table.`>,
) => {
  values: <values extends insertModel | insertModel[]>(
    values: values,
  ) => Promise<selectModel> & {
    onConflictDoNothing: () => Promise<selectModel>;
    onConflictDoUpdate: (
      values: Partial<updateModel> | updateFn,
    ) => Promise<selectModel>;
  };
};

export type Update = <
  table extends Table,
  ///
  insertModel = InferInsertModel<table>,
  selectModel = InferSelectModel<table>,
  insertValues = Prettify<Omit<insertModel, keyof Key<table>>>,
  updateFn = (row: selectModel) => Partial<insertModel>,
>(
  table: table extends { [onchain]: true }
    ? table
    : PonderTypeError<`Indexing functions can only write to onchain tables, and '${table["_"]["name"]}' is an offchain table.`>,
  key: Key<table>,
) => {
  set: (values: Partial<insertValues> | updateFn) => Promise<selectModel>;
};

export type Delete = <table extends Table>(
  table: table extends { [onchain]: true }
    ? table
    : PonderTypeError<`Indexing functions can only write to onchain tables, and '${table["_"]["name"]}' is an offchain table.`>,
  key: Key<table>,
) => Promise<boolean>;
