import { rmSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterEach, expect, test, TestContext } from "vitest";

import { testNetworkConfig } from "@/_test/utils";
import { buildOptions } from "@/config/options";
import { buildPonderConfig } from "@/config/ponderConfig";
import { Ponder } from "@/Ponder";

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
  const testOptions = { ...options, uiEnabled: false, logLevel: 1 };

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

  expect(accounts).toHaveLength(108);
  expect(tokens).toHaveLength(92);

  await ponder.kill();
}, 20_000);

test("returns bigint ids as string", async (context) => {
  const { ponder, gql } = await setup({ context });

  const { tokens } = await gql(`
    tokens {
      id
    }
  `);

  expect(tokens.length).toBeGreaterThan(0);
  for (const token of tokens) {
    expect(typeof token.id).toBe("string");
  }

  await ponder.kill();
}, 20_000);

test("orders asc on bigint fields", async (context) => {
  const { ponder, gql } = await setup({ context });

  const { tokens } = await gql(`
    tokens(orderBy: "id", orderDirection: "asc") {
      id
    }
  `);

  expect(tokens.length).toBeGreaterThan(0);
  expect(tokens.map((t: any) => Number(t.id))).toMatchObject(
    tokens.map((t: any) => Number(t.id)).sort((a: number, b: number) => a - b)
  );

  await ponder.kill();
}, 20_000);

test("orders desc on bigint fields", async (context) => {
  const { ponder, gql } = await setup({ context });

  const { tokens } = await gql(`
    tokens(orderBy: "id", orderDirection: "desc") {
      id
    }
  `);

  expect(tokens.length).toBeGreaterThan(0);
  expect(tokens.map((t: any) => Number(t.id))).toMatchObject(
    tokens.map((t: any) => Number(t.id)).sort((a: number, b: number) => b - a)
  );

  await ponder.kill();
}, 20_000);
