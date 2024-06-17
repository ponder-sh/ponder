import assert from "node:assert";
import { randomBytes } from "node:crypto";
import { describe } from "node:test";
import {
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import type { EventSource, LogFilterCriteria } from "@/config/sources.js";
import type {
  SyncBlock,
  SyncLog,
  SyncTransaction,
  SyncTransactionReceipt,
} from "@/sync/index.js";
import { type Checkpoint, maxCheckpoint } from "@/utils/checkpoint.js";
import { drainAsyncGenerator } from "@/utils/drainAsyncGenerator.js";
import { range } from "@/utils/range.js";
import { type TestContext, bench } from "vitest";
import type { SyncStore } from "./store.js";

let context: TestContext;

const DENSE_BLOCK_RANGE = 250;
const SPARSE_BLOCK_RANGE = 10_000;
const LOGS_PER_TX = 4;
const TX_PER_BLOCK_DENSE = 100;
const TX_PER_BLOCK_SPARSE = 1;

const WARMUP_ITERS = 0;
const MIN_ITERS = 30;

type Case = {
  name: string;
  setupDataSource: () => Promise<void>;
  numBlocks: number;
};

let syncStore: SyncStore;

type GenBlockOptions = {
  block: bigint;
  chainId: number;
  logsPerTx: number;
  txPerBlock: number;
  addr: `0x${string}`;
  topics: [`0x${string}`, ...`0x${string}`[]] | [];
};

/**
 * Generate a block of test data to insert into the syncStore via `insertLogFilterInterval`.
 * For consistency and code simplicity, the timestamp of a block is equal to its block number.
 */
const generateBlock = (
  opts: GenBlockOptions,
): {
  chainId: number;
  logFilter: LogFilterCriteria;
  block: SyncBlock;
  transactions: SyncTransaction[];
  transactionReceipts: SyncTransactionReceipt[];
  logs: SyncLog[];
  interval: { startBlock: bigint; endBlock: bigint };
} => {
  const blockNumber = opts.block;
  const blockHash = randomBlob(256);

  const transactions = [] as SyncTransaction[];
  const logs = [] as SyncLog[];

  for (let txIdx = 0; txIdx < opts.txPerBlock; txIdx++) {
    const transactionHash = randomBlob(256);
    for (let logIdx = 0; logIdx < opts.logsPerTx; logIdx++) {
      const log: SyncLog = {
        address: opts.addr,
        blockHash,
        blockNumber: `0x${blockNumber.toString(16)}`,
        data: randomBlob(2048),
        logIndex: `0x${logIdx.toString(16)}`,
        removed: false,
        topics: opts.topics,
        transactionHash,
        transactionIndex: `0x${txIdx.toString(16)}`,
      };
      logs.push(log);
    }

    transactions.push({
      blockHash,
      blockNumber: `0x${blockNumber.toString(16)}`,
      from: randomBlob(160),
      gas: randomNum(),
      gasPrice: randomNum(),
      hash: transactionHash,
      input: randomBlob(2048),
      nonce: randomNum(16),
      r: randomBlob(256),
      s: randomBlob(256),
      to: opts.addr,
      transactionIndex: `0x${txIdx.toString(16)}`,
      v: "0x0",
      value: "0x0",
      type: "0x0",
    });
  }

  const block: SyncBlock = {
    baseFeePerGas: randomNum(),
    difficulty: randomNum(),
    extraData: randomNum(),
    gasLimit: randomNum(),
    gasUsed: randomNum(),
    hash: blockHash,
    logsBloom: randomBlob(2048),
    miner: randomBlob(160),
    mixHash: randomBlob(256),
    nonce: randomNum(),
    number: `0x${blockNumber.toString(16)}`,
    parentHash: randomBlob(256),
    receiptsRoot: randomBlob(256),
    sealFields: [],
    sha3Uncles: randomBlob(256),
    size: randomNum(),
    stateRoot: randomBlob(256),
    timestamp: `0x${opts.block.toString(16)}`,
    totalDifficulty: randomNum(),
    transactionsRoot: randomBlob(256),
    uncles: [],
    transactions: [],
  };

  return {
    block,
    logs,
    transactions,
    transactionReceipts: [],
    interval: {
      startBlock: opts.block,
      endBlock: opts.block,
    },
    chainId: opts.chainId,
    logFilter: {
      address: opts.addr,
      topics: opts.topics,
      includeTransactionReceipts: false,
    },
  };
};

const randomNum = (max = Number.MAX_SAFE_INTEGER): `0x${string}` => {
  const base10 = Math.floor(Math.random() * max);
  return `0x${base10.toString(16)}`;
};

const randomBlob = (bits: number): `0x${string}` => {
  const bytes = randomBytes(bits / 8);
  return `0x${bytes.toString("hex")}`;
};

let cleanup: () => Promise<void>;

const setupStore = async () => {
  context = {} as TestContext;
  setupCommon(context);

  const cleanupDatabase = await setupIsolatedDatabase(context);
  const { syncStore: syncStore_, cleanup: cleanUpstore } =
    await setupDatabaseServices(context, {
      schema: {},
    });

  cleanup = async () => {
    await cleanUpstore();
    await cleanupDatabase();
  };

  syncStore = syncStore_;
};

const teardown = async () => {
  await cleanup();
};

const CONTRACT_ADDR = randomBlob(160);
const TOPIC_0 = randomBlob(256);

const LOG_FILTER_CASES = [
  {
    name: "dense data with single source",
    numBlocks: DENSE_BLOCK_RANGE,
    setupDataSource: async () => {
      await Promise.all(
        range(0, DENSE_BLOCK_RANGE).map(async (i) => {
          const data = generateBlock({
            addr: CONTRACT_ADDR,
            block: BigInt(i),
            chainId: 1,
            logsPerTx: LOGS_PER_TX,
            txPerBlock: TX_PER_BLOCK_DENSE,
            topics: [TOPIC_0],
          });
          await syncStore.insertLogFilterInterval(data);
        }),
      );
    },
  },
  {
    name: "sparse data single source",
    numBlocks: SPARSE_BLOCK_RANGE,
    setupDataSource: async () => {
      await Promise.all(
        range(0, SPARSE_BLOCK_RANGE).map(async (i) => {
          const data = generateBlock({
            addr: CONTRACT_ADDR,
            block: BigInt(i),
            chainId: 1,
            logsPerTx: LOGS_PER_TX,
            txPerBlock: TX_PER_BLOCK_SPARSE,
            topics: [TOPIC_0],
          });
          await syncStore.insertLogFilterInterval(data);
        }),
      );
    },
  },
  {
    name: "dense data many sources",
    numBlocks: DENSE_BLOCK_RANGE,
    setupDataSource: async () => {
      await Promise.all(
        range(0, DENSE_BLOCK_RANGE).map(async (i) => {
          const data = generateBlock({
            addr: CONTRACT_ADDR,
            block: BigInt(i),
            chainId: 1,
            logsPerTx: LOGS_PER_TX,
            txPerBlock: TX_PER_BLOCK_DENSE,
            topics: [TOPIC_0],
          });
          await syncStore.insertLogFilterInterval(data);
        }),
      );

      await Promise.all(
        range(0, DENSE_BLOCK_RANGE).map(async (i) => {
          const data = generateBlock({
            addr: randomBlob(160),
            block: BigInt(i),
            chainId: 1,
            logsPerTx: LOGS_PER_TX,
            txPerBlock: TX_PER_BLOCK_DENSE,
            topics: [randomBlob(160)],
          });
          await syncStore.insertLogFilterInterval(data);
        }),
      );
    },
  },
  {
    name: "sparse data many sources",
    numBlocks: SPARSE_BLOCK_RANGE,
    setupDataSource: async () => {
      await Promise.all(
        range(0, SPARSE_BLOCK_RANGE).map(async (i) => {
          const data = generateBlock({
            addr: CONTRACT_ADDR,
            block: BigInt(i),
            chainId: 1,
            logsPerTx: LOGS_PER_TX,
            txPerBlock: TX_PER_BLOCK_SPARSE,
            topics: [TOPIC_0],
          });
          await syncStore.insertLogFilterInterval(data);
        }),
      );

      await Promise.all(
        range(0, SPARSE_BLOCK_RANGE).map(async (i) => {
          const data = generateBlock({
            addr: randomBlob(160),
            block: BigInt(i),
            chainId: 1,
            logsPerTx: LOGS_PER_TX,
            txPerBlock: TX_PER_BLOCK_SPARSE,
            topics: [randomBlob(160)],
          });
          await syncStore.insertLogFilterInterval(data);
        }),
      );
    },
  },
] as Case[];

const checkpointBounds = (
  startBlock: number,
  endBlock: number,
): [Checkpoint, Checkpoint] => {
  const fromCheckpoint: Checkpoint = {
    ...maxCheckpoint,
    blockTimestamp: startBlock,
    blockNumber: BigInt(startBlock),
  };
  const toCheckpoint: Checkpoint = {
    ...maxCheckpoint,
    blockNumber: BigInt(startBlock + endBlock),
    blockTimestamp: startBlock + endBlock,
  };

  return [fromCheckpoint, toCheckpoint];
};

for (const c of LOG_FILTER_CASES) {
  describe(`log filter: ${c.name}`, { concurrency: true }, () => {
    bench(
      `log filter: ${c.name}: small checkpoint range`,
      async () => {
        const startBlock = 0;
        const totalBlocks = Math.floor(c.numBlocks * 0.1);
        const [fromCheckpoint, toCheckpoint] = checkpointBounds(
          startBlock,
          totalBlocks,
        );

        const ag = syncStore.getEvents({
          sources: [
            {
              id: "benchFilter",

              startBlock: 0,
              type: "log",
              criteria: {
                address: CONTRACT_ADDR,
                topics: [TOPIC_0],
                includeTransactionReceipts: false,
              },
            },
          ] as EventSource[],
          toCheckpoint,
          fromCheckpoint,
        });
        const events = await drainAsyncGenerator(ag);

        assert(events.length > 0);
      },
      {
        warmupIterations: WARMUP_ITERS,
        iterations: MIN_ITERS,
        teardown,
        setup: async () => {
          await setupStore();
          await c.setupDataSource();
        },
      },
    );

    bench(
      `log filter: ${c.name}: large checkpoint range`,
      async () => {
        const startBlock = 0;
        const totalBlocks = Math.floor(c.numBlocks * 0.9);
        const [fromCheckpoint, toCheckpoint] = checkpointBounds(
          startBlock,
          totalBlocks,
        );

        const ag = syncStore.getEvents({
          sources: [
            {
              id: "benchFilter",
              startBlock: 0,
              type: "log",
              criteria: {
                address: CONTRACT_ADDR,
                topics: [TOPIC_0],
                includeTransactionReceipts: false,
              },
            },
          ] as EventSource[],
          toCheckpoint,
          fromCheckpoint,
        });
        const events = await drainAsyncGenerator(ag);

        assert(events.length > 0);
      },
      {
        warmupIterations: WARMUP_ITERS,
        iterations: MIN_ITERS,
        teardown,
        setup: async () => {
          await setupStore();
          await c.setupDataSource();
        },
      },
    );

    bench(
      `log filter: ${c.name}: empty checkpoint range`,
      async () => {
        const startBlock = c.numBlocks + 5;
        const endBlock = c.numBlocks + 100;
        const [fromCheckpoint, toCheckpoint] = checkpointBounds(
          startBlock,
          endBlock,
        );

        const ag = syncStore.getEvents({
          sources: [
            {
              id: "benchFilter",
              startBlock: 0,
              type: "log",
              criteria: {
                address: CONTRACT_ADDR,
                topics: [TOPIC_0],
                includeTransactionReceipts: false,
              },
            },
          ] as EventSource[],
          toCheckpoint,
          fromCheckpoint,
        });
        const events = await drainAsyncGenerator(ag);

        assert(events.length === 0);
      },
      {
        teardown,
        warmupIterations: WARMUP_ITERS,
        iterations: MIN_ITERS,
        setup: async () => {
          await setupStore();
          await c.setupDataSource();
        },
      },
    );
  });
}
