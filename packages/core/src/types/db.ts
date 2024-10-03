import type { Drizzle, Schema } from "@/drizzle/index.js";
import type {
  Column,
  GetColumnData,
  InferInsertModel,
  InferSelectModel,
  Table,
} from "drizzle-orm";

export type Db<schema extends Schema> = {
  /**
   * Find a row
   */
  find: Find;
  /**
   * Create new rows
   */
  insert: Insert;
  /**
   * Update a row
   */
  update: Update;
  /**
   * If row exists, update, else insert
   */
  upsert: Upsert;
  /**
   * Delete a row
   */
  delete: Delete;
  /**
   * Access the raw drizzle object
   */
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

export type Find = <table extends Table>(
  table: table,
  key: Key<Table>,
) => Promise<InferSelectModel<table> | undefined>;

export type Insert = <table extends Table>(
  table: table,
) => {
  values: (
    values: InferInsertModel<table> | InferInsertModel<table>[],
  ) => Promise<void>;
};

export type Update = <table extends Table>(
  table: table,
  key: Key<Table>,
) => {
  set: (values: Partial<InferInsertModel<table>>) => Promise<void>;
};

export type Upsert = <table extends Table>(
  table: table,
  key: Key<Table>,
) => {
  /** Insert a row */
  insert: (values: Omit<InferInsertModel<table>, InferPrimaryKey<table>>) => {
    /** Update the existing row */
    update: (
      values:
        | Partial<InferInsertModel<table>>
        | ((row: InferSelectModel<table>) => Partial<InferInsertModel<table>>),
    ) => Promise<void>;
  } & Promise<void>;
  /** Update the existing row */
  update: (
    values:
      | Partial<InferInsertModel<table>>
      | ((row: InferSelectModel<table>) => Partial<InferInsertModel<table>>),
  ) => {
    /** Insert a row */
    insert: (
      values: Omit<InferInsertModel<table>, InferPrimaryKey<table>>,
    ) => Promise<void>;
  } & Promise<void>;
};

export type Delete = <table extends Table>(
  table: table,
  key: Key<Table>,
) => Promise<void>;
