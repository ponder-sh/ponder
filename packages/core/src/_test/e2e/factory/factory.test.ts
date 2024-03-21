import { rmSync } from "node:fs";
import { ALICE } from "@/_test/constants.js";
import { setupAnvil, setupIsolatedDatabase } from "@/_test/setup.js";
import { simulatePairSwap } from "@/_test/simulate.js";
import { getFreePort, postGraphql, waitForHealthy } from "@/_test/utils.js";
import { start } from "@/bin/commands/start.js";
import { wait } from "@/utils/wait.js";
import { afterEach, beforeEach, expect, test } from "vitest";

beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

afterEach(() => {
  rmSync("./src/_test/e2e/factory/.ponder", {
    recursive: true,
    force: true,
    retryDelay: 20,
  });
  rmSync("./src/_test/e2e/factory/generated", {
    recursive: true,
    force: true,
  });
});

test("factory", async (context) => {
  const port = await getFreePort();

  const cleanup = await start({
    cliOptions: {
      root: "./src/_test/e2e/factory",
      config: "ponder.config.ts",
      port,
    },
  });

  await waitForHealthy(port);

  await wait(500);

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

  // TODO: Find a consistent way to wait for indexing to be complete.
  await wait(2500);

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
