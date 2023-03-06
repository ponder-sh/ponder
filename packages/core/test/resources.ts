import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { ErrorService } from "@/common/ErrorService";
import { LoggerService } from "@/common/LoggerService";
import { buildContracts } from "@/config/contracts";
import { buildOptions } from "@/config/options";
import { ResolvedPonderConfig } from "@/config/ponderConfig";
import { buildCacheStore } from "@/database/cache/cacheStore";
import { buildDb } from "@/database/db";
import { buildEntityStore } from "@/database/entity/entityStore";
import { Resources } from "@/Ponder";

const defaultConfig: ResolvedPonderConfig = {
  database: {
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
    rootDir,
    configFile: "ponder.config.ts",
    logType: "start",
    silent: true,
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

  return resources;
};
