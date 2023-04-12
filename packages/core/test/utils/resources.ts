import Sqlite from "better-sqlite3";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";

import { LoggerService } from "@/common/LoggerService";
import { buildContracts } from "@/config/contracts";
import { buildLogFilters } from "@/config/logFilters";
import { buildOptions } from "@/config/options";
import { ResolvedPonderConfig } from "@/config/ponderConfig";
import { buildCacheStore } from "@/database/cache/cacheStore";
import { PonderDatabase } from "@/database/db";
import { buildEntityStore } from "@/database/entity/entityStore";
import { ErrorService } from "@/errors/ErrorService";
import { Resources } from "@/Ponder";

const defaultConfig: ResolvedPonderConfig = {
  networks: [
    {
      name: "mainnet",
      chainId: 1,
      rpcUrl: "http://127.0.0.1:8545",
    },
  ],
  contracts: [],
};

export const buildTestResources = async (
  configOverrides: Partial<ResolvedPonderConfig> = {}
) => {
  const tmpDir = os.tmpdir();
  const rootDir = path.join(tmpDir, randomUUID());

  const options = buildOptions({
    cliOptions: {
      rootDir,
      configFile: "ponder.config.ts",
    },
  });

  let database: PonderDatabase;

  if (process.env.DATABASE_URL) {
    // TODO: properly implement isolation when testing with Postgres.
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    database = { kind: "postgres", pool };
  } else {
    // SQLite gets isolation for free when using a new in-memory database
    // for each test.
    const db = Sqlite(":memory:");
    database = { kind: "sqlite", db };
  }

  const config = {
    ...defaultConfig,
    ...configOverrides,
  };

  const logger = new LoggerService({ options });
  const errors = new ErrorService();
  const cacheStore = buildCacheStore({ database });
  const entityStore = buildEntityStore({ database });
  const contracts = buildContracts({ options, config });
  const logFilters = buildLogFilters({ options, config });

  const resources: Resources = {
    options,
    config,
    database,
    cacheStore,
    entityStore,
    contracts,
    logFilters,
    logger,
    errors,
  };

  await cacheStore.migrate();

  return resources;
};
