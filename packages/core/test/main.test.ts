import type Sqlite from "better-sqlite3";
import path from "node:path";

import { readPonderConfig } from "@/common/readPonderConfig";
import { SqliteCacheStore } from "@/db/cache/sqliteCacheStore";
import { SqliteEntityStore } from "@/db/entity/sqliteEntityStore";
import { CachedProvider } from "@/networks/CachedProvider";
import { Ponder } from "@/Ponder";
import { initialInterfaceState } from "@/ui/app";

jest.mock("@ethersproject/providers", () => {
  const originalModule = jest.requireActual("@ethersproject/providers");
  const StaticJsonRpcProvider = originalModule.StaticJsonRpcProvider;

  class MockedStaticJsonRpcProvider extends StaticJsonRpcProvider {
    constructor(url: unknown, chainId: unknown) {
      super(url, chainId);
    }

    async send(method: string, params: Array<unknown>) {
      console.log({ method, params });

      return null;
    }
  }

  return {
    __esModule: true,
    ...originalModule,
    StaticJsonRpcProvider: MockedStaticJsonRpcProvider,
  };
});

const configPath = path.resolve("./test/basic/ponder.config.js");
const config = require(configPath);

describe("Ponder", () => {
  let ponder: Ponder;

  beforeEach(() => {
    ponder = new Ponder(config);
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
      expect(network.provider.connection.url).toBe("rpc://test");
    });

    it("creates a source using defaults", async () => {
      expect(ponder.sources.length).toBe(1);

      const source = ponder.sources[0];

      expect(source.name).toBe("FileStore");
      expect(source.network.name).toBe("mainnet");
      expect(source.network.provider).toBeInstanceOf(CachedProvider);
      expect(source.address).toBe(
        "0x9746fD0A77829E12F8A9DBe70D7a322412325B91".toLowerCase()
      );

      expect(source.startBlock).toBe(15963553);
      expect(source.blockLimit).toBe(1000);
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
        "newNetworkConnected",
        "newBackfillLogs",
        "newFrontfillLogs",
        "backfillTasksAdded",
        "backfillTaskCompleted",
        "handlerTaskStarted",
        "configError",
        "handlerTaskError",
      ]);
    });

    it("initializes internal state", async () => {
      expect(ponder.logsProcessedToTimestamp).toBe(0);
      expect(ponder.isHandlingLogs).toBe(false);
      expect(ponder.interfaceState).toMatchObject(initialInterfaceState);
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

      const db = ponder.database.db as Sqlite.Database;

      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
        .all();

      expect(tables).toMatchObject([
        { name: "__ponder__v1__cachedIntervals" },
        { name: "__ponder__v1__logs" },
        { name: "__ponder__v1__blocks" },
        { name: "__ponder__v1__transactions" },
        { name: "__ponder__v1__contractCalls" },
      ]);
    });
  });
});
