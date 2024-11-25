import type { OnchainTable, PrimaryKeyBuilder } from "@/drizzle/index.js";
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
   * - Docs: https://ponder.sh/docs/indexing/write-to-the-database#find
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
   * - Docs: https://ponder.sh/docs/indexing/write-to-the-database#insert
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
   * ```
   *
   * @param table - The table to insert into.
   */
  insert: Insert;
  /**
   * Update a row
   *
   * - Docs: https://ponder.sh/docs/indexing/write-to-the-database#update
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
   * - Docs: https://ponder.sh/docs/indexing/write-to-the-database#delete
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
   *
   * - Docs: https://ponder.sh/docs/indexing/write-to-the-database#raw-sql
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
) => Promise<InferSelectModel<table> | null>;

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
  /**
   * Create new rows
   *
   * - Docs: https://ponder.sh/docs/indexing/write-to-the-database#insert
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
   * @param table - The table to insert into.
   */
  values: <values extends insertModel | insertModel[]>(
    values: values,
  ) => Promise<values extends unknown[] ? selectModel[] : selectModel> & {
    /**
     * Create new rows, cancelling the insert if there is a conflict
     *
     * - Docs: https://ponder.sh/docs/indexing/write-to-the-database#upsert--conflict-resolution
     * @example
     * ```ts twoslash
     * await db.insert(table).values({ id: 10, name: "joe" }).onConflictDoNothing();
     * ```
     * @param table - The table to insert into.
     */
    onConflictDoNothing: () => Promise<
      values extends unknown[] ? (selectModel | null)[] : selectModel | null
    >;
    /**
     * Create new rows, updating the row if there is a conflict
     *
     * - Docs: https://ponder.sh/docs/indexing/write-to-the-database#upsert--conflict-resolution
     *
     * @example
     * ```ts twoslash
     * await db
     *   .insert(table)
     *   .values({ id: 10, name: "joe" })
     *   .onConflictDoUpdate({ age: 24 });
     * ```
     *
     * @example
     * ```ts twoslash
     * await db
     *   .insert(table)
     *   .values({ id: 10, name: "joe" })
     *   .onConflictDoUpdate((row) => ({ age: row.age + 3 }));
     * ```
     *
     * @param table - The table to insert into.
     */
    onConflictDoUpdate: (
      values: Partial<updateModel> | updateFn,
    ) => Promise<values extends unknown[] ? selectModel[] : selectModel>;
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
  /**
   * Update a row
   *
   * - Docs: https://ponder.sh/docs/indexing/write-to-the-database#update
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
  set: (values: Partial<insertValues> | updateFn) => Promise<selectModel>;
};

export type Delete = <table extends Table>(
  table: table extends { [onchain]: true }
    ? table
    : PonderTypeError<`Indexing functions can only write to onchain tables, and '${table["_"]["name"]}' is an offchain table.`>,
  key: Key<table>,
) => Promise<boolean>;
