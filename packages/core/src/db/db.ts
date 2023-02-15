import Sqlite from "better-sqlite3";
import path from "node:path";
import PgPromise from "pg-promise";

import { logger } from "@/common/logger";
import { ensureDirExists } from "@/common/utils";
import { ResolvedPonderConfig } from "@/config/buildPonderConfig";
import type { Ponder } from "@/Ponder";

export interface SqliteDb {
  kind: "sqlite";
  db: Sqlite.Database;
}

export interface PostgresDb {
  kind: "postgres";
  db: PgPromise.IDatabase<unknown>;
  pgp: PgPromise.IMain;
}

export type PonderDatabase = SqliteDb | PostgresDb;

export const buildDb = ({ ponder }: { ponder: Ponder }): PonderDatabase => {
  let dbConfig: NonNullable<ResolvedPonderConfig["database"]>;

  if (ponder.config.database) {
    if (ponder.config.database.kind === "postgres") {
      dbConfig = {
        kind: "postgres",
        connectionString: ponder.config.database.connectionString,
      };
    } else {
      dbConfig = {
        kind: "sqlite",
        filename: ponder.config.database.filename,
      };
    }
  } else {
    if (process.env.DATABASE_URL) {
      dbConfig = {
        kind: "postgres",
        connectionString: process.env.DATABASE_URL,
      };
    } else {
      const filePath = path.join(ponder.options.PONDER_DIR_PATH, "cache.db");
      ensureDirExists(filePath);
      dbConfig = {
        kind: "sqlite",
        filename: filePath,
      };
    }
  }

  if (dbConfig.kind === "sqlite") {
    const db = Sqlite(dbConfig.filename, { verbose: logger.trace });
    db.pragma("journal_mode = WAL");

    return { kind: "sqlite", db };
  } else {
    const pgp = PgPromise({
      query: (e) => {
        logger.trace({ query: e.query });
      },
      error: (e) => {
        const error = e.error ? e.error : e;
        const query = e.query;

        console.log({ error, query });

        throw new Error(error);
      },
    });

    const db = pgp({
      connectionString: process.env.DATABASE_URL,
      keepAlive: true,
    });

    return { kind: "postgres", db, pgp };
  }
};
