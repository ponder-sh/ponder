import Sqlite from "better-sqlite3";

import { logger } from "@/common/logger";
import type { PonderConfig } from "@/core/readPonderConfig";
import { SqliteCacheStore } from "@/stores/sqliteCacheStore";
import { SqliteEntityStore } from "@/stores/sqliteEntityStore";

export const buildStores = ({ config }: { config: PonderConfig }) => {
  // Build store.
  const defaultDbFilePath = `./.ponder/cache.db`;
  const db = Sqlite(config.database.filename || defaultDbFilePath, {
    verbose: logger.trace,
  });
  const cacheStore = new SqliteCacheStore(db);
  const entityStore = new SqliteEntityStore(db);

  return { cacheStore, entityStore };
};
