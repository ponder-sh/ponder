import Sqlite from "better-sqlite3";

import { logger } from "@/common/logger";
import { PonderConfig } from "@/core/readPonderConfig";

export interface SqliteDb {
  kind: "sqlite";

  db: Sqlite.Database;
}

export interface PostgresDb {
  kind: "postgres";

  db: unknown;
}

export type PonderDatabase = SqliteDb | PostgresDb;

export const buildDb = (config: PonderConfig): PonderDatabase => {
  switch (config.database.kind) {
    case "sqlite": {
      return {
        kind: "sqlite",
        db: Sqlite(config.database.filename || "./.ponder/cache.db", {
          verbose: logger.trace,
        }),
      };
    }
    default: {
      throw new Error(`Unsupported database kind: ${config.database.kind}`);
    }
  }
};
