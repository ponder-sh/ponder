import { rmSync } from "node:fs";
import request from "supertest";
import { type TestContext, afterEach, beforeEach, expect, test } from "vitest";

import { setupEventStore, setupUserStore } from "@/_test/setup";
import { buildOptions } from "@/config/options";
import { Ponder } from "@/Ponder";

beforeEach((context) => setupEventStore(context));
beforeEach((context) => setupUserStore(context));

const setup = async ({ context }: { context: TestContext }) => {
  const options = buildOptions({
    cliOptions: {
      rootDir: "./src/_test/ens/app",
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
    eventStore: context.eventStore,
    userStore: context.userStore,
  });

  await ponder.start();

  // Wait for historical sync event processing to complete.
  await new Promise<void>((resolve) => {
    ponder.indexingService.on("eventsProcessed", ({ toTimestamp }) => {
      // Block 16370020
      if (toTimestamp >= 1673276663) {
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
  rmSync("./src/_test/ens/app/.ponder", { recursive: true, force: true });
  rmSync("./src/_test/ens/app/generated", { recursive: true, force: true });
});

test("serves data", async (context) => {
  const { ponder, gql } = await setup({ context });

  const { ensNfts, accounts } = await gql(`
    ensNfts {
      id
      labelHash
      owner {
        id
      }
      transferredAt
    }
    accounts {
      id
      lastActive
      tokens {
        id
      }
    }
  `);

  expect(ensNfts).toHaveLength(8);
  expect(accounts).toHaveLength(12);

  await ponder.kill();
}, 60_000);
