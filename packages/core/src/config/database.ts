import path from "node:path";

import pg from "pg";

import type { Config } from "@/config/config.js";
import type { Common } from "@/Ponder.js";
import { ensureDirExists } from "@/utils/exists.js";

type StoreConfig =
  | {
      kind: "sqlite";
      file: string;
    }
  | {
      kind: "postgres";
      pool: pg.Pool;
    };

type DatabaseConfig = {
  sync: StoreConfig;
  indexing: StoreConfig;
};

export const buildDatabase = ({
  // TODO: Ue the database config passed by the user.
  common, // config,
}: {
  common: Common;
  config: Config;
}): DatabaseConfig => {
  if (process.env.DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

    return {
      sync: { kind: "postgres", pool },
      indexing: { kind: "postgres", pool },
    } satisfies DatabaseConfig;
  } else {
    const syncFilePath = path.join(
      common.options.ponderDir,
      "store",
      "sync.db",
    );
    ensureDirExists(syncFilePath);
    // const syncDb = Sqlite(syncFilePath);
    // syncDb.pragma("journal_mode = WAL");

    const indexingFilePath = path.join(
      common.options.ponderDir,
      "store",
      "indexing.db",
    );
    ensureDirExists(indexingFilePath);
    // const indexingDb = Sqlite(indexingFilePath, {});
    // indexingDb.pragma("journal_mode = WAL");

    return {
      sync: { kind: "sqlite", file: syncFilePath },
      indexing: { kind: "sqlite", file: indexingFilePath },
    } satisfies DatabaseConfig;
  }
};
