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

import { setup, testClient } from "./utils";

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
    const eventIterator = frontfillService.events("networkConnected");

    await frontfillService.getLatestBlockNumbers();

    await eventIterator.next().then(({ value }) => {
      expect(value).toEqual({
        network: "mainnet",
        blockNumber: 16370000,
        blockTimestamp: 1673276423,
      });
      eventIterator.return?.();
    });

    expect(frontfillService.backfillCutoffTimestamp).toBe(1673276423);
  });

  test("startFrontfill", async () => {
    const taskAddedIterator = frontfillService.events("taskAdded");
    const taskCompletedIterator = frontfillService.events("taskCompleted");

    await frontfillService.getLatestBlockNumbers();
    frontfillService.startFrontfill();

    await testClient.mine({ blocks: 1 });
    // ethers.provider.on("block", listener) doesn't seem to fire twice unless this is here
    await new Promise((r) => setTimeout(r));
    await testClient.mine({ blocks: 1 });

    await taskAddedIterator
      .next()
      .then(({ value }) => {
        expect(value).toEqual({
          network: "mainnet",
          blockNumber: 16370001,
        });
        return taskAddedIterator.next();
      })
      .then(({ value }) => {
        expect(value).toEqual({
          network: "mainnet",
          blockNumber: 16370002,
        });

        return taskAddedIterator.return?.();
      });

    await taskCompletedIterator
      .next()
      .then(({ value }) => {
        expect(value).toEqual({
          network: "mainnet",
          blockNumber: 16370001,
          blockTimestamp: 1673276424,
          blockTxCount: 0,
          matchedLogCount: 0,
        });
        return taskCompletedIterator.next();
      })
      .then(({ value }) => {
        expect(value).toEqual({
          network: "mainnet",
          blockNumber: 16370002,
          blockTimestamp: 1673276425,
          blockTxCount: 0,
          matchedLogCount: 0,
        });
        return taskCompletedIterator.return?.();
      });
  });
});
