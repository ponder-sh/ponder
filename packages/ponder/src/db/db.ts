import Sqlite from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { logger } from "@/common/logger";
import { OPTIONS } from "@/common/options";
import type { PonderConfig } from "@/core/readPonderConfig";

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
      mkdirSync(OPTIONS.PONDER_DIR_PATH, { recursive: true });
      const dbFile = path.join(OPTIONS.PONDER_DIR_PATH, "cache.db");
      return {
        kind: "sqlite",
        db: Sqlite(config.database.filename || dbFile, {
          verbose: logger.trace,
        }),
      };
    }
    default: {
      throw new Error(`Unsupported database kind: ${config.database.kind}`);
    }
  }
};
