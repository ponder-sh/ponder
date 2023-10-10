import Sqlite from "better-sqlite3";
import path from "node:path";
import pg, { Client, DatabaseError, Pool } from "pg";

import type { ResolvedConfig } from "@/config/config";
import type { Options } from "@/config/options";
import { PostgresError } from "@/errors/postgres";
import { SqliteError } from "@/errors/sqlite";
import { ensureDirExists } from "@/utils/exists";

export interface SqliteDb {
  kind: "sqlite";
  db: Sqlite.Database;
}

export interface PostgresDb {
  kind: "postgres";
  pool: Pool;
}

export type Database = SqliteDb | PostgresDb;

// See https://github.com/brianc/node-pg-types for details.
// Set pg protocol to use BigInt for `bytea` types.
// TODO: Remove this once the UserStore migrates to `numeric`.
pg.types.setTypeParser(20, BigInt);
// Set pg protocol to use BigInt for `numeric` types.
pg.types.setTypeParser(1700, BigInt);

// Monkeypatch Pool.query to get more informative stack traces. I have no idea why this works.
// https://stackoverflow.com/a/70601114
const originalClientQuery = Client.prototype.query;
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
Client.prototype.query = async function query(
  ...args: [queryText: string, values: any[], callback: () => void]
) {
  try {
    return await originalClientQuery.apply(this, args);
  } catch (error) {
    const [statement, parameters] = args;

    if (error instanceof DatabaseError) {
      const parameters_ = parameters ?? [];
      throw new PostgresError({
        statement,
        parameters:
          parameters_.length <= 25
            ? parameters_
            : parameters_.slice(0, 26).concat(["..."]),
        pgError: error,
      });
    }

    throw error;
  }
};

export const patchSqliteDatabase = ({ db }: { db: any }) => {
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
            parameters: args[0],
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

export const buildDatabase = ({
  options,
  config,
}: {
  options: Options;
  config: ResolvedConfig;
}): Database => {
  let resolvedDatabaseConfig: NonNullable<ResolvedConfig["database"]>;

  const defaultSqliteFilename = path.join(options.ponderDir, "cache.db");

  if (config.database) {
    if (config.database.kind === "postgres") {
      resolvedDatabaseConfig = {
        kind: "postgres",
        connectionString: config.database.connectionString,
      };
    } else {
      resolvedDatabaseConfig = {
        kind: "sqlite",
        filename: config.database.filename ?? defaultSqliteFilename,
      };
    }
  } else {
    if (process.env.DATABASE_URL) {
      resolvedDatabaseConfig = {
        kind: "postgres",
        connectionString: process.env.DATABASE_URL,
      };
    } else {
      resolvedDatabaseConfig = {
        kind: "sqlite",
        filename: defaultSqliteFilename,
      };
    }
  }

  if (resolvedDatabaseConfig.kind === "sqlite") {
    ensureDirExists(resolvedDatabaseConfig.filename!);
    const rawDb = Sqlite(resolvedDatabaseConfig.filename!);
    rawDb.pragma("journal_mode = WAL");

    const db = patchSqliteDatabase({ db: rawDb });

    return { kind: "sqlite", db };
  } else {
    const pool = new Pool({
      connectionString: resolvedDatabaseConfig.connectionString,
    });

    return { kind: "postgres", pool };
  }
};
