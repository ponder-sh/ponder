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

describe("ens", () => {
  let ponder: Ponder;

  beforeAll(async () => {
    rmSync("./test/Ponder/ens/.ponder", { recursive: true, force: true });
    rmSync("./test/Ponder/ens/generated", { recursive: true, force: true });
    process.env.port = (await getFreePort()).toString();

    const config = await buildPonderConfig({
      configFile: path.resolve("test/Ponder/ens/ponder.config.ts"),
    });
    const options = buildOptions({
      cliOptions: {
        rootDir: "./test/Ponder/ens",
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
        contractAddress:
          "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85".toLowerCase(),
        fromBlockTimestamp: 0,
        toBlockTimestamp: 1673278823, // mainnet 16370200
      });

      expect(logs).toHaveLength(148);

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
    test("inserts data into the entity store", async () => {
      const entity = ponder.resources.entityStore.schema?.entities.find(
        (e) => e.name === "EnsNft"
      );
      expect(entity).toBeDefined();

      const ensNfts = await ponder.resources.entityStore.getEntities({
        entityName: "EnsNft",
      });
      expect(ensNfts.length).toBe(58);
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

      expect(ensNfts).toHaveLength(58);
      expect(accounts).toHaveLength(68);
    });

    test("returns string array types", async () => {
      const { ensNfts } = await gql(`
        ensNfts {
          id
          stringArray
        }
      `);

      expect(ensNfts[0].stringArray).toEqual(["123", "abc"]);
    });

    test("returns int array types", async () => {
      const { ensNfts } = await gql(`
        ensNfts {
          id
          intArray
        }
      `);

      expect(ensNfts[0].intArray).toEqual([123, 456]);
    });

    test("limits", async () => {
      const { ensNfts } = await gql(`
        ensNfts(first: 2) {
          id
        }
      `);

      expect(ensNfts).toHaveLength(2);
    });

    test("skips", async () => {
      const { ensNfts } = await gql(`
        ensNfts(skip: 5) {
          id
        }
      `);

      expect(ensNfts).toHaveLength(53);
    });

    test("orders ascending", async () => {
      const { ensNfts } = await gql(`
        ensNfts(orderBy: "transferredAt", orderDirection: "asc") {
          id
          transferredAt
        }
      `);

      expect(ensNfts.length).toBeGreaterThan(0);
      expect(ensNfts).toBe(
        ensNfts.sort((a: any, b: any) => a.transferredAt - b.transferredAt)
      );
    });

    test("orders descending", async () => {
      const { ensNfts } = await gql(`
        ensNfts(orderBy: "transferredAt", orderDirection: "desc") {
          id
          transferredAt
        }
      `);

      expect(ensNfts.length).toBeGreaterThan(0);
      expect(ensNfts).toBe(
        ensNfts.sort((a: any, b: any) => b.transferredAt - a.transferredAt)
      );
    });

    test("filters on integer field equals", async () => {
      const { ensNfts } = await gql(`
        ensNfts(where: { transferredAt: 1673278703 }) {
          id
          transferredAt
        }
      `);

      expect(ensNfts).toHaveLength(1);
      expect(ensNfts[0].transferredAt).toBe(1673278703);
    });

    test("filters on integer field in", async () => {
      const { ensNfts } = await gql(`
        ensNfts(where: { transferredAt_in: [1673278703, 1673278739] }) {
          id
          transferredAt
        }
      `);

      expect(ensNfts).toHaveLength(2);
      const transferredAt = ensNfts.map((n: any) => n.transferredAt);
      expect(transferredAt).toContain(1673278703);
      expect(transferredAt).toContain(1673278739);
    });

    test("filters on string field equals", async () => {
      const { ensNfts } = await gql(`
        ensNfts(where: { labelHash: "0x547890107c99e60da4fb9602a9e7641d3c380755f3298d0c8edc490b595af6c7" }) {
          id
          labelHash
        }
      `);

      expect(ensNfts).toHaveLength(1);
      expect(ensNfts[0].labelHash).toBe(
        "0x547890107c99e60da4fb9602a9e7641d3c380755f3298d0c8edc490b595af6c7"
      );
    });

    test("filters on string field in", async () => {
      const { ensNfts } = await gql(`
        ensNfts(where: { labelHash_in: ["0x547890107c99e60da4fb9602a9e7641d3c380755f3298d0c8edc490b595af6c7", "0xa594dce9890a89d2a1399c0870196851ca7a0db19650fb38c682a6599a6b4d9b"] }) {
          id
          labelHash
        }
      `);

      expect(ensNfts).toHaveLength(2);
      expect(ensNfts[0].labelHash).toBe(
        "0x547890107c99e60da4fb9602a9e7641d3c380755f3298d0c8edc490b595af6c7"
      );
      expect(ensNfts[1].labelHash).toBe(
        "0xa594dce9890a89d2a1399c0870196851ca7a0db19650fb38c682a6599a6b4d9b"
      );
    });

    test("filters on relationship field equals", async () => {
      const { ensNfts } = await gql(`
        ensNfts(where: { owner: "0x3b42845cD161fE095e083aF493525271a3CF27cf" }) {
          id
          owner {
            id
          }
        }
      `);

      expect(ensNfts).toHaveLength(2);
      expect(ensNfts[0].owner.id).toBe(
        "0x3b42845cD161fE095e083aF493525271a3CF27cf"
      );
      expect(ensNfts[1].owner.id).toBe(
        "0x3b42845cD161fE095e083aF493525271a3CF27cf"
      );
    });

    test("filters on relationship field contains", async () => {
      const { ensNfts } = await gql(`
        ensNfts(where: { owner_contains: "0x3b42845cD161f" }) {
          id
          owner {
            id
          }
        }
      `);

      expect(ensNfts).toHaveLength(2);
      expect(ensNfts[0].owner.id).toBe(
        "0x3b42845cD161fE095e083aF493525271a3CF27cf"
      );
      expect(ensNfts[1].owner.id).toBe(
        "0x3b42845cD161fE095e083aF493525271a3CF27cf"
      );
    });
  });
});
