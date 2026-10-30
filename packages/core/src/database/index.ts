import { pgSchema, pgTable } from "drizzle-orm/pg-core";

export const SCHEMATA = pgSchema("information_schema").table(
  "schemata",
  (t) => ({
    schemaName: t.text().primaryKey(),
  }),
);

export const TABLES = pgSchema("information_schema").table("tables", (t) => ({
  table_name: t.text().notNull(),
  table_schema: t.text().notNull(),
  table_type: t.text().notNull(),
}));

export const VIEWS = pgSchema("information_schema").table("views", (t) => ({
  table_name: t.text().notNull(),
  table_schema: t.text().notNull(),
}));

export const LEGACY_MIGRATIONS = pgSchema("ponder_sync").table(
  "kysely_migration",
  (t) => ({ name: t.text().primaryKey() }),
);

export const PONDER_META_TABLE_NAME = "_ponder_meta";
/**
 * @dev Used since version 0.11.
 */
export const PONDER_CHECKPOINT_TABLE_NAME = "_ponder_checkpoint";
/**
 * @dev Used from version 0.9 to 0.11.
 */
export const PONDER_STATUS_TABLE_NAME = "_ponder_status";

// Note: "version" was introduced in 0.9

export type PonderApp0 = {
  version: undefined;
  is_locked: 0 | 1;
  is_dev: 0 | 1;
  heartbeat_at: number;
  build_id: string;
  checkpoint: string;
  table_names: string[];
};

export type PonderApp1 = {
  version: "1";
  build_id: string;
  table_names: string[];
  is_locked: 0 | 1;
  is_ready: 0 | 1;
  heartbeat_at: number;
};
export type PonderApp2 = Omit<PonderApp1, "version"> & {
  version: "2";
  is_dev: 0 | 1;
};

export type PonderApp3 = Omit<PonderApp2, "version"> & {
  version: "3";
};
export type PonderApp4 = Omit<PonderApp3, "version"> & {
  version: "4";
};
export type PonderApp5 = Omit<PonderApp4, "version"> & {
  version: "5";
  view_names: string[];
};
export type PonderApp6 = Omit<PonderApp5, "version"> & {
  version: "6";
};

export const VERSION = "6";

export const getPonderMetaTable = (schema?: string) => {
  if (schema === undefined || schema === "public") {
    return pgTable(PONDER_META_TABLE_NAME, (t) => ({
      key: t.text().primaryKey().$type<"app">(),
      value: t.jsonb().$type<PonderApp6>().notNull(),
    }));
  }

  return pgSchema(schema).table(PONDER_META_TABLE_NAME, (t) => ({
    key: t.text().primaryKey().$type<"app">(),
    value: t.jsonb().$type<PonderApp6>().notNull(),
  }));
};

/**
 * @dev It is an invariant that `latestCheckpoint` refers to the same chain as `chainId`.
 */
export const getPonderCheckpointTable = (schema?: string) => {
  if (schema === undefined || schema === "public") {
    return pgTable(PONDER_CHECKPOINT_TABLE_NAME, (t) => ({
      chainName: t.text().primaryKey(),
      chainId: t.bigint({ mode: "number" }).notNull(),
      safeCheckpoint: t.varchar({ length: 75 }).notNull(),
      latestCheckpoint: t.varchar({ length: 75 }).notNull(),
      finalizedCheckpoint: t.varchar({ length: 75 }).notNull(),
    }));
  }

  return pgSchema(schema).table(PONDER_CHECKPOINT_TABLE_NAME, (t) => ({
    chainName: t.text().primaryKey(),
    chainId: t.bigint({ mode: "number" }).notNull(),
    safeCheckpoint: t.varchar({ length: 75 }).notNull(),
    latestCheckpoint: t.varchar({ length: 75 }).notNull(),
    finalizedCheckpoint: t.varchar({ length: 75 }).notNull(),
  }));
};

/**
 * Create the database drivers and query builders.
 *
 * @dev The drivers are closed, the heartbeat is stopped, and the schema is unlocked when the scope closes.
 */
