import path from "node:path";
import { ALICE } from "@/_test/constants.js";
import {
  setupAnvil,
  setupCommon,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { simulatePairSwap } from "@/_test/simulate.js";
import {
  getFreePort,
  postGraphql,
  waitForIndexedBlock,
} from "@/_test/utils.js";
import { start } from "@/bin/commands/start.js";
import { rimrafSync } from "rimraf";
import { beforeEach, expect, test } from "vitest";

const rootDir = path.join(".", "src", "_test", "e2e", "factory");
beforeEach(() => {
  rimrafSync(path.join(rootDir, ".ponder"));
  rimrafSync(path.join(rootDir, "generated"));
});

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

const cliOptions = {
  root: "./src/_test/e2e/factory",
  config: "ponder.config.ts",
  logLevel: "error",
  logFormat: "pretty",
};

test("factory", async (context) => {
  const port = await getFreePort();

  const cleanup = await start({
    cliOptions: {
      ...cliOptions,
      command: "start",
      port,
    },
  });

  await waitForIndexedBlock(port, "mainnet", 5);

  let response = await postGraphql(
    port,
    `
    swapEvents {
      items {
        id
        pair
        from
        to
      }
    }
    `,
  );

  expect(response.status).toBe(200);
  let body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  let swapEvents = body.data.swapEvents.items;

  expect(swapEvents).toHaveLength(1);
  expect(swapEvents[0]).toMatchObject({
    id: expect.any(String),
    from: ALICE.toLowerCase(),
    to: ALICE.toLowerCase(),
    pair: context.factory.pair.toLowerCase(),
  });

  await simulatePairSwap(context.factory.pair);

  await waitForIndexedBlock(port, "mainnet", 6);

  response = await postGraphql(
    port,
    `
    swapEvents {
      items {
        id
        pair
        from
        to
      }
    }
    `,
  );

  expect(response.status).toBe(200);
  body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  swapEvents = body.data.swapEvents.items;

  expect(swapEvents).toHaveLength(2);

  await cleanup();
});
