import Sqlite from "better-sqlite3";
import path from "node:path";
import { Pool } from "pg";

import { LoggerService } from "@/common/LoggerService";
import { ensureDirExists } from "@/common/utils";
import { PonderOptions } from "@/config/options";
import { ResolvedPonderConfig } from "@/config/ponderConfig";

// Patch Pool.query to get more informative stack traces. I have no idea why this works.
// https://stackoverflow.com/a/70601114
const originalPoolQuery = Pool.prototype.query;
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
Pool.prototype.query = async function query(...args) {
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return await originalPoolQuery.apply(this, args);
  } catch (e) {
    // All magic is here. new Error will generate new stack, but message will copyid from e
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    throw new Error(e);
  }
};

export interface SqliteDb {
  kind: "sqlite";
  db: Sqlite.Database;
}

export interface PostgresDb {
  kind: "postgres";
  pool: Pool;
}

export type PonderDatabase = SqliteDb | PostgresDb;

export const buildDb = ({
  options,
  config,
  logger,
}: {
  options: PonderOptions;
  config: ResolvedPonderConfig;
  logger: LoggerService;
}): PonderDatabase => {
  let resolvedDatabaseConfig: NonNullable<ResolvedPonderConfig["database"]>;

  if (config.database) {
    if (config.database.kind === "postgres") {
      resolvedDatabaseConfig = {
        kind: "postgres",
        connectionString: config.database.connectionString,
      };
    } else {
      resolvedDatabaseConfig = {
        kind: "sqlite",
        filename: config.database.filename,
      };
    }
  } else {
    if (process.env.DATABASE_URL) {
      resolvedDatabaseConfig = {
        kind: "postgres",
        connectionString: process.env.DATABASE_URL,
      };
    } else {
      const filePath = path.join(options.PONDER_DIR_PATH, "cache.db");
      ensureDirExists(filePath);
      resolvedDatabaseConfig = {
        kind: "sqlite",
        filename: filePath,
      };
    }
  }

  if (resolvedDatabaseConfig.kind === "sqlite") {
    const db = Sqlite(resolvedDatabaseConfig.filename, {
      verbose: logger.trace,
    });
    db.pragma("journal_mode = WAL");

    return { kind: "sqlite", db };
  } else {
    const rawPool = new Pool({
      connectionString: resolvedDatabaseConfig.connectionString,
    });

    return { kind: "postgres", pool: rawPool };
  }
};
