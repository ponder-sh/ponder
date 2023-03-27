import Sqlite from "better-sqlite3";
import path from "node:path";
import { DatabaseError, Pool } from "pg";

import { LoggerService } from "@/common/LoggerService";
import { ensureDirExists } from "@/common/utils";
import { PonderOptions } from "@/config/options";
import { ResolvedPonderConfig } from "@/config/ponderConfig";
import { PostgresError } from "@/errors/postgres";
import { SqliteError } from "@/errors/sqlite";

// Monkeypatch Pool.query to get more informative stack traces. I have no idea why this works.
// https://stackoverflow.com/a/70601114
const originalPoolQuery = Pool.prototype.query;
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
Pool.prototype.query = async function query(
  ...args: [queryText: string, values: any[], callback: () => void]
) {
  try {
    return await originalPoolQuery.apply(this, args);
  } catch (error) {
    const [statement, parameters] = args;

    if (error instanceof DatabaseError) {
      throw new PostgresError({
        statement,
        parameters,
        pgError: error,
      });
    }

    throw error;
  }
};

const patchSqliteDatabase = ({ db }: { db: Sqlite.Database }) => {
  const oldPrepare = db.prepare;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  db.prepare = (source: string) => {
    const statement = oldPrepare.apply(db, [source]);

    const wrapper =
      (fn: (...args: any) => void) =>
      (...args: any) => {
        try {
          return fn.apply(statement, args);
        } catch (error) {
          throw new SqliteError({
            statement: source,
            parameters: args,
            sqliteError: error as Error,
          });
        }
      };

    for (const method of ["run", "get", "all"]) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      statement[method] = wrapper(statement[method]);
    }

    return statement;
  };

  return db;
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
      const filePath = path.join(options.ponderDir, "cache.db");
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

    const patchedDb = patchSqliteDatabase({ db });

    return { kind: "sqlite", db: patchedDb };
  } else {
    const rawPool = new Pool({
      connectionString: resolvedDatabaseConfig.connectionString,
    });

    return { kind: "postgres", pool: rawPool };
  }
};
