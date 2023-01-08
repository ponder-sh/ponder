import { JsonRpcProvider } from "@ethersproject/providers";
import type Sqlite from "better-sqlite3";

import { SqliteCacheStore } from "@/db/cache/sqliteCacheStore";
import { SqliteEntityStore } from "@/db/entity/sqliteEntityStore";
import { CachedProvider } from "@/networks/CachedProvider";
import { Ponder } from "@/Ponder";
import { getUiState } from "@/ui/app";

import { buildSendFunc } from "./fixtures/buildSendFunc";

beforeAll(() => {
  const sendFunc = buildSendFunc();
  jest.spyOn(JsonRpcProvider.prototype, "send").mockImplementation(sendFunc);
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("Ponder", () => {
  let ponder: Ponder;

  beforeEach(() => {
    ponder = new Ponder({
      command: "dev",
      rootDir: "./test/basic",
      configFile: "ponder.config.js",
      silent: true,
    });
  });

  afterEach(async () => {
    await ponder.kill();
  });

  describe("constructor", () => {
    it("creates a network using CachedProvider", async () => {
      expect(ponder.networks.length).toBe(1);

      const network = ponder.networks[0];
      expect(network.name).toBe("mainnet");
      expect(network.chainId).toBe(1);

      expect(network.provider).toBeInstanceOf(CachedProvider);
      expect(network.provider.network.chainId).toBe(1);
      expect(network.provider.connection.url).toBe("rpc://test");
    });

    it("creates a source matching config", async () => {
      expect(ponder.sources.length).toBe(1);
      const source = ponder.sources[0];
      expect(source.name).toBe("ArtGobblers");
      expect(source.network.name).toBe("mainnet");
      expect(source.network.provider).toBeInstanceOf(CachedProvider);
      expect(source.address).toBe("0x60bb1e2aa1c9acafb4d34f71585d7e959f387769");
      expect(source.startBlock).toBe(15863321);
      expect(source.blockLimit).toBe(500);
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
        "config_error",
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
      expect(ponder.plugins).toMatchObject([]);
    });
  });

  describe("setup()", () => {
    it("creates the render interval", async () => {
      await ponder.setup();

      expect(ponder.renderInterval).toBeDefined();
    });

    it("migrates the cache store", async () => {
      await ponder.setup();

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
      await ponder.setup();

      expect(ponder.handlerQueue).toBeTruthy();
    });

    it("builds the schema", async () => {
      await ponder.setup();

      expect(ponder.schema?.entities.length).toBe(1);
    });

    it("migrates the entity store", async () => {
      await ponder.setup();

      const tables = (ponder.database.db as Sqlite.Database)
        .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
        .all();
      const tableNames = tables.map((t) => t.name);

      expect(tableNames).toContain("GobbledArt");
    });
  });

  describe("backfill()", () => {
    beforeEach(async () => {
      await ponder.setup();
    });

    it("works", async () => {
      await ponder.backfill();

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

      expect(logs.length).toBe(6);
      expect(blocks.length).toBe(6);
      expect(transactions.length).toBe(6);
    });
  });
});
