import { JsonRpcProvider } from "@ethersproject/providers";
import type Sqlite from "better-sqlite3";
import request from "supertest";

import { SqliteCacheStore } from "@/db/cache/sqliteCacheStore";
import { SqliteEntityStore } from "@/db/entity/sqliteEntityStore";
import { CachedProvider } from "@/networks/CachedProvider";
import { Ponder } from "@/Ponder";
import { getUiState } from "@/ui/app";

import { buildSendFunc } from "./utils/buildSendFunc";
import { createPonderInstance } from "./utils/createPonderInstance";
import {
  BaseRegistrarImplementation,
  BaseRegistrarImplementationHandlers,
  BaseRegistrarImplementationSchema,
  mainnet,
} from "./utils/sources";

beforeAll(() => {
  const sendFunc = buildSendFunc();
  jest.spyOn(JsonRpcProvider.prototype, "send").mockImplementation(sendFunc);
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("Ponder", () => {
  let ponder: Ponder;

  beforeEach(async () => {
    ponder = await createPonderInstance({
      networks: [mainnet],
      sources: [BaseRegistrarImplementation],
      schema: BaseRegistrarImplementationSchema,
      handlers: BaseRegistrarImplementationHandlers,
    });
  });

  afterEach(() => {
    ponder.kill();
  });

  describe("constructor", () => {
    it("creates a network using CachedProvider", async () => {
      expect(ponder.networks.length).toBe(1);

      const network = ponder.networks[0];
      expect(network.name).toBe("mainnet");
      expect(network.chainId).toBe(1);

      expect(network.provider).toBeInstanceOf(CachedProvider);
      expect(network.provider.network.chainId).toBe(1);
    });

    it("creates a source matching config", async () => {
      expect(ponder.sources.length).toBe(1);
      const source = ponder.sources[0];
      expect(source.name).toBe("BaseRegistrarImplementation");
      expect(source.network.name).toBe("mainnet");
      expect(source.network.provider).toBeInstanceOf(CachedProvider);
      expect(source.address).toBe("0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85");
      expect(source.startBlock).toBe(16370000);
      expect(source.blockLimit).toBe(100);
    });

    it("creates a sqlite database", async () => {
      expect(ponder.database.kind).toBe("sqlite");
    });

    it("builds a cache store", async () => {
      expect(ponder.cacheStore).toBeInstanceOf(SqliteCacheStore);
    });

    it("builds an entity store", async () => {
      expect(ponder.entityStore).toBeInstanceOf(SqliteEntityStore);
    });

    it("registers event listeners", async () => {
      expect(ponder.eventNames()).toMatchObject([
        "dev_error",
        "backfill_networkConnected",
        "backfill_sourceStarted",
        "backfill_logTasksAdded",
        "backfill_blockTasksAdded",
        "backfill_logTaskDone",
        "backfill_blockTaskDone",
        "backfill_newLogs",
        "frontfill_newLogs",
        "indexer_taskStarted",
        "indexer_taskDone",
      ]);
    });

    it("initializes internal state", async () => {
      expect(ponder.logsProcessedToTimestamp).toBe(0);
      expect(ponder.isHandlingLogs).toBe(false);
      expect(ponder.ui).toMatchObject(getUiState(ponder.options));
    });

    it("builds plugins", async () => {
      expect(ponder.plugins).toHaveLength(1);
      expect(ponder.plugins[0].name).toBe("graphql");
    });
  });

  describe("setup()", () => {
    beforeEach(async () => {
      await ponder.setup();
    });

    it("creates the render interval", async () => {
      expect(ponder.renderInterval).toBeDefined();
    });

    it("migrates the cache store", async () => {
      const tables = (ponder.database.db as Sqlite.Database)
        .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
        .all();
      const tableNames = tables.map((t) => t.name);

      expect(tableNames).toContain("__ponder__v1__cachedIntervals");
      expect(tableNames).toContain("__ponder__v1__logs");
      expect(tableNames).toContain("__ponder__v1__blocks");
      expect(tableNames).toContain("__ponder__v1__transactions");
      expect(tableNames).toContain("__ponder__v1__contractCalls");
    });

    it("creates the handler queue", async () => {
      expect(ponder.handlerQueue).toBeTruthy();
    });

    it("builds the schema", async () => {
      expect(ponder.schema?.entities.length).toBe(2);
    });

    it("migrates the entity store", async () => {
      const tables = (ponder.database.db as Sqlite.Database)
        .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
        .all();
      const tableNames = tables.map((t) => t.name);

      expect(tableNames).toContain("EnsNft");
      expect(tableNames).toContain("Account");
    });
  });

  describe("backfill()", () => {
    beforeEach(async () => {
      await ponder.setup();
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

  describe("handlers", () => {
    beforeEach(async () => {
      await ponder.setup();
      await ponder.backfill();
      await ponder.handlerQueue?.process();
    });

    it("inserts data into the entity store", async () => {
      await ponder.handlerQueue?.process();

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
      await ponder.backfill();
      await ponder.handlerQueue?.process();

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
