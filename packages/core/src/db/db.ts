import Sqlite from "better-sqlite3";
import path from "node:path";
import PgPromise from "pg-promise";

import { logger } from "@/common/logger";
import { ensureDirExists } from "@/common/utils";
import type { Ponder } from "@/Ponder";

export interface SqliteDb {
  kind: "sqlite";

  db: Sqlite.Database;
}

export interface PostgresDb {
  kind: "postgres";

  pgp: PgPromise.IMain<unknown>;
  db: PgPromise.IDatabase<unknown>;
}

export type PonderDatabase = SqliteDb | PostgresDb;

export const buildDb = ({ ponder }: { ponder: Ponder }): PonderDatabase => {
  switch (ponder.config.database.kind) {
    case "sqlite": {
      const dbFilePath =
        ponder.config.database.filename ||
        path.join(ponder.options.PONDER_DIR_PATH, "cache.db");
      ensureDirExists(dbFilePath);

      return {
        kind: "sqlite",
        db: Sqlite(dbFilePath, { verbose: logger.trace }),
      };
    }
    case "postgres": {
      const pgp = PgPromise({
        query: (e) => {
          logger.trace({ query: e.query });
        },
        error: (err, e) => {
          logger.error({ err, e });
        },
      });

      return {
        kind: "postgres",
        pgp,
        db: pgp({
          connectionString: ponder.config.database.connectionString,
          keepAlive: true,
        }),
      };
    }
  }
};
