import { rmSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, expect, test, TestContext } from "vitest";

import { setupEventStore, setupUserStore } from "@/_test/setup";
import { testNetworkConfig } from "@/_test/utils";
import { buildOptions } from "@/config/options";
import { buildPonderConfig } from "@/config/ponderConfig";
import { Ponder } from "@/Ponder";

beforeEach(setupEventStore);
beforeEach(setupUserStore);

const setup = async ({ context }: { context: TestContext }) => {
  const config = await buildPonderConfig({
    configFile: path.resolve("src/_test/art-gobblers/app/ponder.config.ts"),
  });
  // Inject proxied anvil chain.
  const testConfig = { ...config, networks: [testNetworkConfig] };

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
      // Block 15870405
      if (toTimestamp >= 1667247815) {
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
