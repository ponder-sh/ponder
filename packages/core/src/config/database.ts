import path from "node:path";
import type { Common } from "@/Ponder.js";
import type { Config } from "@/config/config.js";
import { createPool } from "@/utils/pg.js";
import { type SqliteDatabase, createSqliteDatabase } from "@/utils/sqlite.js";
import type { Pool } from "pg";
import parse from "pg-connection-string";

const getDatabaseName = (connectionString: string) => {
  const parsed = (parse as unknown as typeof parse.parse)(connectionString);
  return `${parsed.host}:${parsed.port}/${parsed.database}`;
};

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
  const { ponderDir, rootDir } = common.options;
  const defaultStorePath = path.join(ponderDir, "store");
  const defaultSyncFilePath = path.join(defaultStorePath, "sync.db");
  const defaultIndexingFilePath = path.join(defaultStorePath, "indexing.db");
  const sqlitePrintPath = path.relative(rootDir, defaultStorePath);

  // If the user manually specified a database, use it.
  if (config.database?.kind) {
    if (config.database.kind === "postgres") {
      let connectionString: string | undefined = undefined;
      let source: string | undefined = undefined;

      if (config.database.connectionString) {
        connectionString = config.database.connectionString;
        source = "ponder.config.ts";
      } else if (process.env.DATABASE_PRIVATE_URL) {
        connectionString = process.env.DATABASE_PRIVATE_URL;
        source = "DATABASE_PRIVATE_URL env var";
      } else if (process.env.DATABASE_URL) {
        connectionString = process.env.DATABASE_URL;
        source = "DATABASE_URL env var";
      } else {
        throw new Error(
          `Invalid database configuration: "kind" is set to "postgres" but no connection string was provided.`,
        );
      }

      common.logger.info({
        service: "database",
        msg: `Using Postgres database ${getDatabaseName(
          connectionString,
        )} (from ${source})`,
      });

      const pool = createPool({ connectionString });

      return {
        sync: { kind: "postgres", pool },
        indexing: { kind: "postgres", pool },
      } satisfies DatabaseConfig;
    }

    // Otherwise, it's SQLite.
    common.logger.info({
      service: "database",
      msg: `Using SQLite database at ${sqlitePrintPath} (from ponder.config.ts)`,
    });
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

  let connectionString: string | undefined = undefined;
  let source: string | undefined = undefined;

  if (process.env.DATABASE_PRIVATE_URL) {
    connectionString = process.env.DATABASE_PRIVATE_URL;
    source = "DATABASE_PRIVATE_URL env var";
  } else if (process.env.DATABASE_URL) {
    connectionString = process.env.DATABASE_URL;
    source = "DATABASE_URL env var";
  }

  // If either of the DATABASE_URL env vars are set, use them.
  if (connectionString !== undefined) {
    const pool = createPool({ connectionString });

    common.logger.info({
      service: "database",
      msg: `Using Postgres database ${getDatabaseName(
        connectionString,
      )} (from ${source})`,
    });

    return {
      sync: { kind: "postgres", pool },
      indexing: { kind: "postgres", pool },
    } satisfies DatabaseConfig;
  }

  // Fall back to SQLite.
  common.logger.info({
    service: "database",
    msg: `Using SQLite database at ${sqlitePrintPath} (default)`,
  });

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
};
