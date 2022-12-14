import { StaticJsonRpcProvider } from "@ethersproject/providers";
import type Sqlite from "better-sqlite3";

import { SqliteCacheStore } from "@/db/cache/sqliteCacheStore";
import { SqliteEntityStore } from "@/db/entity/sqliteEntityStore";
import { CachedProvider } from "@/networks/CachedProvider";
import { Ponder } from "@/Ponder";
import { getUiState } from "@/ui/app";

import { Hash, mockLog, randomHex } from "./utils";
import { mockBlock, toHex, toNumber } from "./utils";

type SendArgs =
  | ["eth_getBlockByNumber", ["latest" | Hash, boolean]]
  | ["eth_getBlockByHash", ["latest" | Hash, boolean]]
  | ["eth_getLogs", [{ address: Hash[]; fromBlock: Hash; toBlock: Hash }]];

beforeAll(() => {
  jest
    .spyOn(StaticJsonRpcProvider.prototype, "send")
    .mockImplementation(async (...args) => {
      const [method, params] = args as unknown as SendArgs;

      console.log("in send with:", { method, params });

      switch (method) {
        case "eth_getBlockByNumber": {
          const [number] = params;
          const mockNumber = number === "latest" ? toHex(10) : number;
          return mockBlock({ number: mockNumber });
        }
        case "eth_getBlockByHash": {
          const [hash, includeTxns] = params;
          const mockHash = hash === "latest" ? randomHex() : hash;
          return mockBlock({ hash: mockHash });
        }
        case "eth_getLogs": {
          const [{ address, fromBlock, toBlock }] = params;
          const logAddress = address[0];
          const middleBlock = toHex(
            Math.floor(toNumber(toBlock) - toNumber(fromBlock) / 2) +
              toNumber(toBlock)
          );

          return [
            mockLog({ address: logAddress, blockNumber: fromBlock }),
            mockLog({ address: logAddress, blockNumber: middleBlock }),
            mockLog({ address: logAddress, blockNumber: toBlock }),
          ];
        }
        default: {
          throw new Error(
            `MockedStaticJsonRpcProvider: Unhandled method ${method}`
          );
        }
      }
    });
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("Ponder", () => {
  let ponder: Ponder;

  beforeEach(() => {
    ponder = new Ponder({
      rootDir: "./test/basic",
      configFile: "ponder.config.js",
      silent: false,
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
      expect(network.provider.connection.url).toBe("rpc://test");
    });

    it("creates a source matching config", async () => {
      expect(ponder.sources.length).toBe(1);

      const source = ponder.sources[0];
      expect(source.name).toBe("FileStore");
      expect(source.network.name).toBe("mainnet");
      expect(source.network.provider).toBeInstanceOf(CachedProvider);
      expect(source.address).toBe(
        "0x9746fD0A77829E12F8A9DBe70D7a322412325B91".toLowerCase()
      );
      expect(source.startBlock).toBe(0);
      expect(source.blockLimit).toBe(5);
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

    it("builds the schema", async () => {
      expect(ponder.schema.entities.length).toBe(1);
    });

    it("registers event listeners", async () => {
      expect(ponder.eventNames()).toMatchObject([
        "config_error",
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
        "indexer_taskError",
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

    it("migrates the entity store", async () => {
      await ponder.setup();

      const tables = (ponder.database.db as Sqlite.Database)
        .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
        .all();
      const tableNames = tables.map((t) => t.name);

      expect(tableNames).toContain("File");
    });

    it("creates the handler queue", async () => {
      await ponder.setup();

      expect(ponder.handlerQueue).toBeTruthy();
    });
  });

  describe("backfill()", () => {
    beforeEach(async () => {
      await ponder.setup();
    });

    it("works", async () => {
      await ponder.backfill();

      expect(1).toBe(2);
    });
  });
});
