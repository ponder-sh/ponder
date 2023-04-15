import { rmSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { buildOptions } from "@/config/options";
import { buildPonderConfig } from "@/config/ponderConfig";
import { Ponder } from "@/Ponder";

import { testClient } from "../utils/clients";
import { getFreePort } from "../utils/getFreePort";

beforeAll(async () => {
  await testClient.reset({
    blockNumber: BigInt(parseInt(process.env.ANVIL_BLOCK_NUMBER!)),
    jsonRpcUrl: process.env.ANVIL_FORK_URL,
  });
});

describe("art-gobblers", () => {
  let ponder: Ponder;

  beforeAll(async () => {
    rmSync("./test/Ponder/art-gobblers/.ponder", {
      recursive: true,
      force: true,
    });
    rmSync("./test/Ponder/art-gobblers/generated", {
      recursive: true,
      force: true,
    });
    process.env.port = (await getFreePort()).toString();

    const config = await buildPonderConfig({
      configFile: path.resolve("test/Ponder/art-gobblers/ponder.config.ts"),
    });
    const options = buildOptions({
      cliOptions: {
        rootDir: "./test/Ponder/art-gobblers",
        configFile: "ponder.config.ts",
      },
    });
    const testOptions = { ...options, uiEnabled: false, logLevel: 0 };

    ponder = new Ponder({ config, options: testOptions });

    await ponder.start();
  });

  afterAll(async () => {
    await ponder.kill();
  });

  describe("backfill", () => {
    test("inserts backfill data into the cache store", async () => {
      const logs = await ponder.resources.cacheStore.getLogs({
        chainId: 1,
        address:
          "0x60bb1e2aa1c9acafb4d34f71585d7e959f387769".toLowerCase() as `0x${string}`,
        fromBlockTimestamp: 0,
        toBlockTimestamp: 1667247995, // mainnet 15870420
      });

      expect(logs).toHaveLength(651);

      for (const log of logs) {
        const block = await ponder.resources.cacheStore.getBlock(log.blockHash);
        expect(block).toBeTruthy();

        const transaction = await ponder.resources.cacheStore.getTransaction(
          log.transactionHash
        );
        expect(transaction).toBeTruthy();
      }
    });
  });

  describe("event processing", () => {
    test("inserts data into the entity store from setup event", async () => {
      const setupEntities = await ponder.resources.entityStore.getEntities({
        entityName: "SetupEntity",
      });
      expect(setupEntities.length).toBe(1);
    });

    test("inserts data into the entity store", async () => {
      const accounts = await ponder.resources.entityStore.getEntities({
        entityName: "Account",
      });
      expect(accounts.length).toBe(316);

      const tokens = await ponder.resources.entityStore.getEntities({
        entityName: "Token",
      });
      expect(tokens.length).toBe(273);
    });
  });

  describe("graphql", () => {
    let gql: (query: string) => Promise<any>;

    beforeAll(() => {
      const app = request(ponder.serverService.app);

      gql = async (query) => {
        const response = await app
          .post("/")
          .send({ query: `query { ${query} }` });

        expect(response.body.errors).toBe(undefined);
        expect(response.statusCode).toBe(200);

        return response.body.data;
      };
    });

    test("serves data", async () => {
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
    });

    test("returns bigint ids as string", async () => {
      const { tokens } = await gql(`
        tokens {
          id
        }
      `);

      expect(tokens.length).toBeGreaterThan(0);
      for (const token of tokens) {
        expect(typeof token.id).toBe("string");
      }
    });

    test("orders asc on bigint fields", async () => {
      const { tokens } = await gql(`
        tokens(orderBy: "id", orderDirection: "asc") {
          id
        }
      `);

      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens.map((t: any) => Number(t.id))).toMatchObject(
        tokens
          .map((t: any) => Number(t.id))
          .sort((a: number, b: number) => a - b)
      );
    });

    test("orders desc on bigint fields", async () => {
      const { tokens } = await gql(`
        tokens(orderBy: "id", orderDirection: "desc") {
          id
        }
      `);

      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens.map((t: any) => Number(t.id))).toMatchObject(
        tokens
          .map((t: any) => Number(t.id))
          .sort((a: number, b: number) => b - a)
      );
    });
  });
});
