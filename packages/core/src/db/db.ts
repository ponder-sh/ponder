import Sqlite from "better-sqlite3";
import path from "node:path";
import { Pool } from "pg";

import { logger } from "@/common/logger";
import { ensureDirExists } from "@/common/utils";
import { ResolvedPonderConfig } from "@/config/buildPonderConfig";
import type { Ponder } from "@/Ponder";

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
    const rawPool = new Pool({
      connectionString: dbConfig.connectionString,
    });

    // const pool = {
    //   connect: () => rawPool.connect(),
    //   query: (text: string, params: any[]) => {
    //     logger.trace({ query: text, params });
    //     return rawPool.query(text, params);
    //   },
    // };

    return { kind: "postgres", pool: rawPool };
  }
};
