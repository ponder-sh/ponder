import { JsonRpcProvider } from "@ethersproject/providers";
import type Sqlite from "better-sqlite3";
import { rmSync } from "node:fs";
import request from "supertest";

import { buildPonderConfig } from "@/buildPonderConfig";
import { buildOptions } from "@/common/options";
import { Ponder } from "@/Ponder";

import { buildSendFunc } from "./utils/buildSendFunc";
import { getFreePort } from "./utils/getFreePort";

beforeAll(() => {
  jest
    .spyOn(JsonRpcProvider.prototype, "send")
    .mockImplementation(buildSendFunc("BaseRegistrarImplementation"));
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("Ponder", () => {
  let ponder: Ponder;

  beforeEach(async () => {
    rmSync("./test/projects/ens/.ponder", { recursive: true, force: true });
    rmSync("./test/projects/ens/generated", { recursive: true, force: true });
    process.env.PORT = (await getFreePort()).toString();

    const options = buildOptions({
      rootDir: "./test/projects/ens",
      configFile: "ponder.ts",
      logType: "start",
      silent: true,
    });

    const config = await buildPonderConfig(options);
    ponder = new Ponder({ options, config });
  });

  afterEach(async () => {
    await ponder?.kill();
  });

  describe("backfill()", () => {
    beforeEach(async () => {
      await ponder.setup();
      await ponder.getLatestBlockNumbers();
      await ponder.backfill();
    });

    it("inserts backfill data into the cache store", async () => {
      expect(ponder.ui.isBackfillComplete).toBe(true);

      const logs = (ponder.database.db as Sqlite.Database)
        .prepare(`SELECT * FROM __ponder__v1__logs`)
        .all();

      const blocks = (ponder.database.db as Sqlite.Database)
        .prepare(`SELECT * FROM __ponder__v1__blocks`)
        .all();

      const transactions = (ponder.database.db as Sqlite.Database)
        .prepare(`SELECT * FROM __ponder__v1__transactions`)
        .all();

      expect(logs.length).toBe(148);
      expect(blocks.length).toBe(66);
      expect(transactions.length).toBe(76);
    });
  });

  describe("processLogs()", () => {
    beforeEach(async () => {
      await ponder.setup();
      await ponder.getLatestBlockNumbers();
      await ponder.backfill();
      await ponder.processLogs();
    });

    it("inserts data into the entity store", async () => {
      const ensNfts = (ponder.database.db as Sqlite.Database)
        .prepare(`SELECT * FROM EnsNft`)
        .all();

      expect(ensNfts.length).toBe(58);
    });
  });

  describe("graphql", () => {
    let gql: (query: string) => Promise<any>;

    beforeEach(async () => {
      await ponder.setup();
      await ponder.getLatestBlockNumbers();
      await ponder.backfill();
      await ponder.processLogs();

      gql = async (query) => {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const app = request(ponder.plugins[0].server.app);
        const response = await app
          .post("/graphql")
          .send({ query: `query { ${query} }` });

        expect(response.body.errors).toBeUndefined();
        return response.body.data;
      };
    });

    it("serves data", async () => {
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

    it("limits", async () => {
      const { ensNfts } = await gql(`
        ensNfts(first: 2) {
          id
        }
      `);

      expect(ensNfts).toHaveLength(2);
    });

    it("skips", async () => {
      const { ensNfts } = await gql(`
        ensNfts(skip: 5) {
          id
        }
      `);

      expect(ensNfts).toHaveLength(53);
    });

    it("orders ascending", async () => {
      const { ensNfts } = await gql(`
        ensNfts(orderBy: "transferredAt", orderDirection: "asc") {
          id
          transferredAt
        }
      `);

      expect(ensNfts).toBe(
        ensNfts.sort((a: any, b: any) => a.transferredAt - b.transferredAt)
      );
    });

    it("orders descending", async () => {
      const { ensNfts } = await gql(`
        ensNfts(orderBy: "transferredAt", orderDirection: "desc") {
          id
          transferredAt
        }
      `);

      expect(ensNfts).toBe(
        ensNfts.sort((a: any, b: any) => b.transferredAt - a.transferredAt)
      );
    });

    it("filters on integer field equals", async () => {
      const { ensNfts } = await gql(`
        ensNfts(where: { transferredAt: 1673278703 }) {
          id
          transferredAt
        }
      `);

      expect(ensNfts).toHaveLength(1);
      expect(ensNfts[0].transferredAt).toBe(1673278703);
    });

    it("filters on integer field in", async () => {
      const { ensNfts } = await gql(`
        ensNfts(where: { transferredAt_in: [1673278703, 1673278739] }) {
          id
          transferredAt
        }
      `);

      expect(ensNfts).toHaveLength(2);
      expect(ensNfts[0].transferredAt).toBe(1673278703);
      expect(ensNfts[1].transferredAt).toBe(1673278739);
    });

    it("filters on string field equals", async () => {
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

    it("filters on string field in", async () => {
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

    it("filters on relationship field equals", async () => {
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

    it("filters on relationship field contains", async () => {
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
