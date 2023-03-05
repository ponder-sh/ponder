import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ErrorService } from "@/common/ErrorService";
import { LoggerService } from "@/common/LoggerService";
import { buildContracts } from "@/config/contracts";
import { buildOptions } from "@/config/options";
import { buildPonderConfig } from "@/config/ponderConfig";
import { buildCacheStore } from "@/database/cache/cacheStore";
import { buildDb } from "@/database/db";
import { buildEntityStore } from "@/database/entity/entityStore";
import { FrontfillService } from "@/frontfill/FrontfillService";
import { Resources } from "@/Ponder";

import { setup } from "./utils";

export const buildTestResources = async ({ rootDir }: { rootDir: string }) => {
  const options = buildOptions({
    rootDir,
    configFile: "ponder.config.ts",
    logType: "start",
    silent: true,
  });
  const config = await buildPonderConfig(options);

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

  return resources;
};

describe("FrontfillService", () => {
  let frontfillService: FrontfillService;

  beforeEach(async () => {
    await setup();

    const resources = await buildTestResources({
      rootDir: "./test/projects/ens",
    });

    frontfillService = new FrontfillService({ resources });

    // rmSync("./test/projects/ens/.ponder", { recursive: true, force: true });
    // rmSync("./test/projects/ens/generated", { recursive: true, force: true });
    // process.env.PORT = (await getFreePort()).toString();
  });

  afterEach(() => {
    frontfillService.killQueues();
  });

  test("getLatestBlockNumbers", async () => {
    const emit = vi.spyOn(frontfillService, "emit");

    await frontfillService.getLatestBlockNumbers();

    expect(emit).toBeCalledWith("networkConnected", {
      network: "mainnet",
      blockNumber: 16370000,
      blockTimestamp: 1673276423,
    });

    expect(frontfillService.backfillCutoffTimestamp).toBe(1673276423);
  });

  test("startFrontfill", async () => {
    const emit = vi.spyOn(frontfillService, "emit");

    await frontfillService.getLatestBlockNumbers();
    frontfillService.startFrontfill();

    await new Promise((r) => setTimeout(r, 2000));

    expect(emit).toBeCalledWith("taskAdded", {
      network: "mainnet",
      blockNumber: 16370000,
    });
    expect(emit).toBeCalledWith("taskAdded", {
      network: "mainnet",
      blockNumber: 16370000,
    });
  });
});
