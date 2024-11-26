import path from "node:path";
import { ALICE } from "@/_test/constants.js";
import {
  setupAnvil,
  setupCommon,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { deployFactory } from "@/_test/simulate.js";
import { createPair } from "@/_test/simulate.js";
import { swapPair } from "@/_test/simulate.js";
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

test("factory", async () => {
  const port = await getFreePort();

  const cleanup = await start({
    cliOptions: {
      ...cliOptions,
      command: "start",
      port,
    },
  });

  const { address } = await deployFactory({ sender: ALICE });
  const { result: pair } = await createPair({
    factory: address,
    sender: ALICE,
  });
  await swapPair({
    pair,
    amount0Out: 1n,
    amount1Out: 1n,
    to: ALICE,
    sender: ALICE,
  });

  await waitForIndexedBlock(port, "mainnet", 3);

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
    pair,
  });

  await swapPair({
    pair,
    amount0Out: 1n,
    amount1Out: 1n,
    to: ALICE,
    sender: ALICE,
  });

  await waitForIndexedBlock(port, "mainnet", 4);

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
