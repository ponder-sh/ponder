import { rmSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { testNetworkConfig } from "test/utils/utils";
import { afterEach, expect, test } from "vitest";

import { buildOptions } from "@/config/options";
import { buildPonderConfig } from "@/config/ponderConfig";
import { Ponder } from "@/Ponder";

const setup = async () => {
  const config = await buildPonderConfig({
    configFile: path.resolve("test/Ponder/art-gobblers/ponder.config.ts"),
  });
  // Inject proxied anvil chain.
  const testConfig = { ...config, networks: [testNetworkConfig] };

  const options = buildOptions({
    cliOptions: {
      rootDir: "./test/Ponder/art-gobblers",
      configFile: "ponder.config.ts",
    },
  });
  const testOptions = { ...options, uiEnabled: false, logLevel: 0 };

  const ponder = new Ponder({ config: testConfig, options: testOptions });

  const app = request(ponder.serverService.app);

  const gql = async (query: string) => {
    const response = await app.post("/").send({ query: `query { ${query} }` });

    expect(response.body.errors).toBe(undefined);
    expect(response.statusCode).toBe(200);

    return response.body.data;
  };

  return { ponder, gql };
};

afterEach(() => {
  rmSync("./test/Ponder/art-gobblers/.ponder", {
    recursive: true,
    force: true,
  });
  rmSync("./test/Ponder/art-gobblers/generated", {
    recursive: true,
    force: true,
  });
});

test("serves data", async () => {
  const { ponder, gql } = await setup();

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

  expect(accounts).toHaveLength(316);
  expect(tokens).toHaveLength(273);

  await ponder.kill();
});

test("returns bigint ids as string", async () => {
  const { ponder, gql } = await setup();

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
});

test("orders asc on bigint fields", async () => {
  const { ponder, gql } = await setup();

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
});

test("orders desc on bigint fields", async () => {
  const { ponder, gql } = await setup();

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
});
