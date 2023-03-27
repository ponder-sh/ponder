import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { LoggerService } from "@/common/LoggerService";
import { buildContracts } from "@/config/contracts";
import { buildOptions } from "@/config/options";
import { ResolvedPonderConfig } from "@/config/ponderConfig";
import { buildCacheStore } from "@/database/cache/cacheStore";
import { buildDb } from "@/database/db";
import { buildEntityStore } from "@/database/entity/entityStore";
import { ErrorService } from "@/errors/ErrorService";
import { Resources } from "@/Ponder";

import { resetCacheStore } from "./resetCacheStore";

const defaultConfig: ResolvedPonderConfig = {
  database: process.env.DATABASE_URL
    ? {
        kind: "postgres",
        connectionString: process.env.DATABASE_URL,
      }
    : {
        kind: "sqlite",
        filename: ":memory:",
      },
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

  const config = {
    ...defaultConfig,
    ...configOverrides,
  };

  const logger = new LoggerService({ options });
  const errors = new ErrorService();
  const database = buildDb({ options, config, logger });
  const cacheStore = buildCacheStore({ database });
  const entityStore = buildEntityStore({ database });
  const contracts = buildContracts({ options, config });

  const resources: Resources = {
    options,
    config,
    database,
    cacheStore,
    entityStore,
    contracts,
    logger,
    errors,
  };

  await resources.cacheStore.migrate();
  await resetCacheStore(database);

  return resources;
};
