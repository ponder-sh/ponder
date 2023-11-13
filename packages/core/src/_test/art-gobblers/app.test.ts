import { rmSync } from "node:fs";

import request from "supertest";
import { afterEach, beforeEach, expect, test, type TestContext } from "vitest";

import { setupIndexingStore, setupSyncStore } from "@/_test/setup.js";
import { buildOptions } from "@/config/options.js";
import { Ponder } from "@/Ponder.js";

beforeEach((context) => setupSyncStore(context));
beforeEach((context) => setupIndexingStore(context));

const setup = async ({ context }: { context: TestContext }) => {
  const options = buildOptions({
    cliOptions: {
      rootDir: "./src/_test/art-gobblers/app",
      configFile: "ponder.config.ts",
    },
  });
  const testOptions = {
    ...options,
    uiEnabled: false,
    logLevel: "error",
    telemetryDisabled: true,
  } as const;

  const ponder = new Ponder({ options: testOptions });
  await ponder.setup({
    syncStore: context.syncStore,
    indexingStore: context.indexingStore,
  });

  await ponder.start();

  // Wait for historical sync event processing to complete.
  await new Promise<void>((resolve) => {
    ponder.indexingService.on("eventsProcessed", ({ toTimestamp }) => {
      // Block 15870405
      if (toTimestamp >= 1667247815) {
        resolve();
      }
    });
  });

  const gql = async (query: string) => {
    const response = await request(ponder.serverService.app)
      .post("/graphql")
      .send({ query: `query { ${query} }` });

    expect(response.body.errors).toBe(undefined);
    expect(response.statusCode).toBe(200);

    return response.body.data;
  };

  return { ponder, gql };
};

afterEach(() => {
  rmSync("./src/_test/art-gobblers/app/.ponder", {
    recursive: true,
    force: true,
  });
  rmSync("./src/_test/art-gobblers/app/generated", {
    recursive: true,
    force: true,
  });
});

test("serves data", async (context) => {
  const { ponder, gql } = await setup({ context });

  const { accounts, tokens } = await gql(`
    accounts {
      id
      tokens {
        id
      }
    }
    tokens {
      id
      owner {
        id
      }
    }
  `);

  expect(accounts).toHaveLength(100);
  expect(tokens).toHaveLength(92);

  await ponder.kill();
}, 60_000);
