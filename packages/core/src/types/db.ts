import type { Drizzle, Schema } from "@/drizzle/index.js";
import type {
  Column,
  GetColumnData,
  InferInsertModel,
  InferSelectModel,
  Table,
} from "drizzle-orm";

export type Db<schema extends Schema> = {
  find: Find;
  insert: Insert;
  update: Update;
  raw: Drizzle<schema>;
};

// TODO(kyle) handle serial
// TODO(kyle) handle composite
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

type Key<table extends Table> = {
  [columnName in InferPrimaryKey<table>]: GetColumnData<
    table["_"]["columns"][columnName]
  >;
};

/**
 * Find a row
 */
export type Find = <table extends Table>(
  table: table,
  key: Key<Table>,
) => Promise<InferSelectModel<table> | undefined>;

/**
 * Create new rows
 */
export type Insert = <table extends Table>(
  table: table,
) => {
  values: (
    values: InferInsertModel<table> | InferInsertModel<table>[],
  ) => Promise<void>;
};

/**
 * Update a row
 */
export type Update = <table extends Table>(
  table: table,
  key: Key<Table>,
) => {
  set: (values: Partial<InferInsertModel<table>>) => Promise<void>;
};

/**
 * Delete a row
 */
export type Delete = <table extends Table>(
  table: table,
  key: Key<Table>,
) => Promise<void>;
