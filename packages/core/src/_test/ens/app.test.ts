import { rmSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, expect, test, TestContext } from "vitest";

import { setupEventStore, setupUserStore } from "@/_test/setup";
import { testNetworkConfig } from "@/_test/utils";
import { buildOptions } from "@/config/options";
import { buildPonderConfig } from "@/config/ponderConfig";
import { Ponder } from "@/Ponder";

beforeEach(async (context) => await setupEventStore(context));
beforeEach(async (context) => await setupUserStore(context));

const setup = async ({ context }: { context: TestContext }) => {
  const config = await buildPonderConfig({
    configFile: path.resolve("src/_test/ens/app/ponder.config.ts"),
  });
  // Inject proxied anvil chain.
  const testConfig = { ...config, networks: [testNetworkConfig] };

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
  } as const;

  const ponder = new Ponder({
    config: testConfig,
    options: testOptions,
    eventStore: context.eventStore,
    userStore: context.userStore,
  });

  await ponder.start();

  // Wait for historical sync event processing to complete.
  await new Promise<void>((resolve) => {
    ponder.eventHandlerService.on("eventsProcessed", ({ toTimestamp }) => {
      // Block 16370020
      if (toTimestamp >= 1673276663) {
        resolve();
      }
    });
  });

  const gql = async (query: string) => {
    const response = await request(ponder.serverService.app)
      .post("/")
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
