import path from "node:path";

import type { Common } from "@/Ponder.js";
import type { Config } from "@/config/config.js";
import { createPool } from "@/utils/pg.js";
import { type SqliteDatabase, createSqliteDatabase } from "@/utils/sqlite.js";
import type { Pool } from "pg";

type StoreConfig =
  | { kind: "sqlite"; database: SqliteDatabase }
  | { kind: "postgres"; pool: Pool };

export type DatabaseConfig = {
  sync: StoreConfig;
  indexing: StoreConfig;
};

export const buildDatabase = ({
  common,
  config,
}: {
  common: Common;
  config: Config;
}): DatabaseConfig => {
  const ponderDir = common.options.ponderDir;
  const defaultSyncFilePath = path.join(ponderDir, "store", "sync.db");
  const defaultIndexingFilePath = path.join(ponderDir, "store", "indexing.db");

  // If the user manually specified a database, use it.
  if (config.database?.kind) {
    if (config.database.kind === "sqlite") {
      return {
        sync: {
          kind: "sqlite",
          database: createSqliteDatabase(defaultSyncFilePath),
        },
        indexing: {
          kind: "sqlite",
          database: createSqliteDatabase(defaultIndexingFilePath),
        },
      } satisfies DatabaseConfig;
    } else {
      const connectionString = (config.database.connectionString ??
        process.env.DATABASE_URL)!;
      const pool = createPool({ connectionString });
      return {
        sync: { kind: "postgres", pool },
        indexing: { kind: "postgres", pool },
      } satisfies DatabaseConfig;
    }
  }

  // Otherwise, check if the DATABASE_URL env var is set. If it is, use it, otherwise use SQLite.
  if (process.env.DATABASE_URL) {
    const connectionString = process.env.DATABASE_URL;
    const pool = createPool({ connectionString });
    return {
      sync: { kind: "postgres", pool },
      indexing: { kind: "postgres", pool },
    } satisfies DatabaseConfig;
  } else {
    return {
      sync: {
        kind: "sqlite",
        database: createSqliteDatabase(defaultSyncFilePath),
      },
      indexing: {
        kind: "sqlite",
        database: createSqliteDatabase(defaultIndexingFilePath),
      },
    } satisfies DatabaseConfig;
  }
};
