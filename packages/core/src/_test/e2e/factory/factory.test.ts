import { rmSync } from "node:fs";
import { Ponder } from "@/Ponder.js";
import { setupAnvil, setupIsolatedDatabase } from "@/_test/setup.js";
import { simulatePairSwap } from "@/_test/simulate.js";
import { onAllEventsIndexed } from "@/_test/utils.js";
import { buildOptions } from "@/common/options.js";
import { range } from "@/utils/range.js";
import request from "supertest";
import { afterEach, beforeEach, expect, test } from "vitest";

beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

const gql = async (ponder: Ponder, query: string) => {
  const response = await request(ponder.serverService.app)
    .post("/")
    .send({ query: `query { ${query} }` });
  expect(response.body.errors).toBe(undefined);
  expect(response.statusCode).toBe(200);
  return response.body.data;
};

afterEach(() => {
  rmSync("./src/_test/e2e/factory/.ponder", {
    recursive: true,
    force: true,
  });
  rmSync("./src/_test/e2e/factory/generated", {
    recursive: true,
    force: true,
  });
});

test("factory", async (context) => {
  const options = buildOptions({
    cliOptions: { root: "./src/_test/e2e/factory", config: "ponder.config.ts" },
  });
  const testOptions = {
    ...options,
    uiEnabled: false,
    logLevel: "error",
    telemetryDisabled: true,
  } as const;

  const ponder = new Ponder({ options: testOptions });
  await ponder.start(context.databaseConfig);
  if (!ponder.database.isPublished) {
    await onAllEventsIndexed(ponder, 4);
  }

  let swapEvents = await gql(
    ponder,
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
  ).then((g) => g.swapEvents.items);

  expect(swapEvents).toHaveLength(1);

  const indexedPromise = onAllEventsIndexed(ponder, 5);
  await simulatePairSwap(context.factory.pair);
  await indexedPromise;

  swapEvents = await gql(
    ponder,
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
  ).then((g) => g.swapEvents.items);

  expect(swapEvents).toHaveLength(2);

  await ponder.kill();
});
