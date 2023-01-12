import Sqlite from "better-sqlite3";
import path from "node:path";
import PgPromise from "pg-promise";

import { logger } from "@/common/logger";
import { ensureDirExists } from "@/common/utils";
import type { Ponder } from "@/Ponder";

export const pgp = PgPromise({
  query: (e) => {
    logger.trace({ query: e.query });
  },
});

export interface SqliteDb {
  kind: "sqlite";
  db: Sqlite.Database;
}

export interface PostgresDb {
  kind: "postgres";
  db: PgPromise.IDatabase<unknown>;
}

export type PonderDatabase = SqliteDb | PostgresDb;

export const buildDb = ({ ponder }: { ponder: Ponder }): PonderDatabase => {
  if (!ponder.config.database) {
    if (process.env.DATABASE_URL) {
      const db = pgp({
        connectionString: process.env.DATABASE_URL,
        keepAlive: true,
      });

      return { kind: "postgres", db };
    } else {
      const dbFilePath = path.join(ponder.options.PONDER_DIR_PATH, "cache.db");
      ensureDirExists(dbFilePath);
      const db = Sqlite(dbFilePath, { verbose: logger.trace });
      db.pragma("journal_mode = WAL");

      return { kind: "sqlite", db };
    }
  }

  // If a database was provided, use it.
  if (ponder.config.database.kind === "sqlite") {
    const dbFilePath = ponder.config.database.filename;
    ensureDirExists(dbFilePath);
    const db = Sqlite(dbFilePath, { verbose: logger.trace });
    db.pragma("journal_mode = WAL");

    return { kind: "sqlite", db };
  } else {
    const db = pgp({
      connectionString: ponder.config.database.connectionString,
      keepAlive: true,
    });

    return { kind: "postgres", db };
  }
};
