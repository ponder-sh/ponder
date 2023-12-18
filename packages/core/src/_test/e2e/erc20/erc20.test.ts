import { rmSync } from "node:fs";

import request from "supertest";
import { afterEach, beforeEach, expect, test } from "vitest";

import {
  setupEthClient,
  setupIndexingStore,
  setupSyncStore,
} from "@/_test/setup.js";
import { simulate } from "@/_test/simulate.js";
import { publicClient } from "@/_test/utils.js";
import { buildOptions } from "@/config/options.js";
import { Ponder } from "@/Ponder.js";
import { range } from "@/utils/range.js";

beforeEach((context) => setupEthClient(context));
beforeEach((context) => setupSyncStore(context));
beforeEach((context) => setupIndexingStore(context));

const gql = async (ponder: Ponder, query: string) => {
  const response = await request(ponder.serverService.app)
    .post("/")
    .send({ query: `query { ${query} }` });
  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  return response.body.data;
};

afterEach(() => {
  rmSync("./src/_test/e2e/erc20/.ponder", {
    recursive: true,
    force: true,
  });
  rmSync("./src/_test/e2e/erc20/generated", {
    recursive: true,
    force: true,
  });
});

test("erc20", async (context) => {
  const options = buildOptions({
    cliOptions: {
      rootDir: "./src/_test/e2e/erc20",
      configFile: "ponder.config.ts",
    },
  });
  const testOptions = {
    ...options,
    uiEnabled: false,
    logLevel: "error",
    telemetryDisabled: true,
  } as const;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const _ in range(0, 3)) {
    await simulate({
      erc20Address: context.erc20.address,
      factoryAddress: context.factory.address,
    });
  }

  const ponder = new Ponder({ options: testOptions });
  await ponder.setup({
    syncStore: context.syncStore,
    indexingStore: context.indexingStore,
  });

  await ponder.start();

  // Wait for all events to be indexed
  await new Promise<void>((resolve) => {
    ponder.indexingService.on("eventsProcessed", async ({ toCheckpoint }) => {
      if (
        toCheckpoint.blockNumber === Number(await publicClient.getBlockNumber())
      ) {
        resolve();
      }
    });
  });

  await gql(
    ponder,
    `
    accounts {
      id
      balance
    }
    `,
  );

  await ponder.kill();
});
