import { rmSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { type TestContext, afterEach, beforeEach, expect, test } from "vitest";

import { setupEventStore, setupUserStore } from "@/_test/setup.js";
import { testNetworkConfig } from "@/_test/utils.js";
import { buildConfig } from "@/config/config.js";
import { buildOptions } from "@/config/options.js";
import { Ponder } from "@/Ponder.js";

beforeEach((context) => setupEventStore(context));
beforeEach((context) => setupUserStore(context));

const setup = async ({ context }: { context: TestContext }) => {
  const config = await buildConfig({
    configFile: path.resolve("src/_test/ens/app/ponder.config.ts"),
  });
  // Inject proxied anvil chain.
  const testConfig = { ...config, networks: [testNetworkConfig] };

  const options = buildOptions({
    cliOptions: {
      rootDir: "./src/_test/ens/app.js",
      configFile: "ponder.config.ts",
    },
  });
  const testOptions = {
    ...options,
    uiEnabled: false,
    logLevel: "error",
    telemetryDisabled: true,
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
      .post("/graphql")
      .send({ query: `query { ${query} }` });

    expect(response.body.errors).toBe(undefined);
    expect(response.statusCode).toBe(200);

    return response.body.data;
  };

  return { ponder, gql };
};

afterEach(() => {
  rmSync("./src/_test/ens/app/.ponder.js", { recursive: true, force: true });
  rmSync("./src/_test/ens/app/generated.js", { recursive: true, force: true });
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
