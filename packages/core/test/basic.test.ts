import { JsonRpcProvider } from "@ethersproject/providers";
import { rmSync } from "node:fs";

import { buildOptions } from "@/common/options";
import { buildPonderConfig } from "@/config/buildPonderConfig";
import { SqliteCacheStore } from "@/db/cache/sqliteCacheStore";
import { SqliteDb } from "@/db/db";
import { SqliteEntityStore } from "@/db/entity/sqliteEntityStore";
import { CachedProvider } from "@/indexer/CachedProvider";
import { Ponder } from "@/Ponder";
import { Server } from "@/server/Server";

import { buildSendFunc } from "./utils/buildSendFunc";
import { getFreePort } from "./utils/getFreePort";

beforeAll(() => {
  jest
    .spyOn(JsonRpcProvider.prototype, "send")
    .mockImplementation(buildSendFunc("Empty"));
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("Ponder", () => {
  let ponder: Ponder;

  beforeEach(async () => {
    rmSync("./test/projects/basic/.ponder", { recursive: true, force: true });
    rmSync("./test/projects/basic/generated", { recursive: true, force: true });
    process.env.PORT = (await getFreePort()).toString();

    const options = buildOptions({
      rootDir: "./test/projects/basic",
      configFile: "ponder.config.ts",
      logType: "start",
      silent: true,
    });

    const config = await buildPonderConfig(options);
    ponder = new Ponder({ options, config });
  });

  afterEach(async () => {
    await ponder?.kill();
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

    it("creates a contract matching config", async () => {
      expect(ponder.contracts.length).toBe(1);
      const contract = ponder.contracts[0];
      expect(contract.name).toBe("Empty");
      expect(contract.network.name).toBe("mainnet");
      expect(contract.network.provider).toBeInstanceOf(CachedProvider);
      expect(contract.address).toBe(
        "0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85"
      );
      expect(contract.startBlock).toBe(10);
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

    it("builds server", async () => {
      expect(ponder.server).toBeInstanceOf(Server);
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
      const tables = (ponder.database as SqliteDb).db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
        .all();
      const tableNames = tables.map((t) => t.name);

      expect(tableNames).toContain("__ponder__v2__cachedIntervals");
      expect(tableNames).toContain("__ponder__v2__logs");
      expect(tableNames).toContain("__ponder__v2__blocks");
      expect(tableNames).toContain("__ponder__v2__transactions");
      expect(tableNames).toContain("__ponder__v2__contractCalls");
    });

    it("creates the handler queue", async () => {
      expect(ponder.handlerQueue).toBeTruthy();
    });

    it("builds the schema", async () => {
      expect(ponder.schema?.entities.length).toBe(1);
    });

    it("migrates the entity store", async () => {
      const tables = (ponder.database as SqliteDb).db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
        .all();
      const tableNames = tables.map((t) => t.name);

      expect(tableNames).toContain("Entity");
    });

    it("does not watch files", async () => {
      expect(ponder.killWatchers).toBeFalsy();
    });
  });

  describe("getLatestBlockNumbers()", () => {
    beforeEach(async () => {
      await ponder.setup();
      await ponder.getLatestBlockNumbers();
    });

    it("adds an endBlock to every indexed contract", async () => {
      expect(
        ponder.contracts.filter((s) => s.isIndexed).map((s) => s.endBlock)
      ).not.toContain(undefined);
    });
  });

  describe("watch()", () => {
    beforeEach(async () => {
      await ponder.setup();
      ponder.watch();
    });

    it("registers the killWatchers callback", async () => {
      expect(ponder.killWatchers).toBeTruthy();
    });
  });

  describe("backfill()", () => {
    beforeEach(async () => {
      await ponder.setup();
      await ponder.getLatestBlockNumbers();
      await ponder.backfill();
    });

    it("inserts data into the cache store", async () => {
      expect(ponder.ui.isBackfillComplete).toBe(true);

      const cachedIntervals = (ponder.database as SqliteDb).db
        .prepare(`SELECT * FROM __ponder__v2__cachedIntervals`)
        .all();
      expect(cachedIntervals.length).toBeGreaterThan(0);
    });
  });

  describe("processLogs()", () => {
    beforeEach(async () => {
      await ponder.setup();
      await ponder.getLatestBlockNumbers();
      await ponder.backfill();
      await ponder.processLogs();
    });

    it("finishes processing logs", async () => {
      expect(ponder.isProcessingLogs).toBe(false);
    });
  });
});
