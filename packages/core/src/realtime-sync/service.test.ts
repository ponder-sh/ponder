/* eslint-disable @typescript-eslint/no-unused-vars */
import { expect, test, vi } from "vitest";

import { accounts, usdcContractConfig, vitalik } from "@/_test/constants";
import { publicClient, testClient, walletClient } from "@/_test/utils";
import { encodeLogFilterKey } from "@/config/logFilterKey";
import { LogFilter } from "@/config/logFilters";
import { Network } from "@/config/networks";
import { range } from "@/utils/range";

import { RealtimeSyncService } from "./service";

const network: Network = {
  name: "mainnet",
  chainId: 1,
  client: publicClient,
  pollingInterval: 1_000,
  defaultMaxBlockRange: 3,
  finalityBlockCount: 5,
};

const logFilters: LogFilter[] = [
  {
    name: "USDC",
    ...usdcContractConfig,
    network,
    filter: {
      key: encodeLogFilterKey({
        chainId: network.chainId,
        address: usdcContractConfig.address,
      }),
      address: usdcContractConfig.address,
      startBlock: 16369950,
      // Note: the service uses the `finalizedBlockNumber` as the end block if undefined.
      endBlock: undefined,
    },
    maxBlockRange: network.defaultMaxBlockRange,
  },
];

// const spy = vi.spyOn(network.client, "request");

// let latestBlockRequestCount = 0;

// // eslint-disable-next-line @typescript-eslint/ban-ts-comment
// // @ts-ignore
// const impl: PublicRequests["request"] = async (args) => {
//   switch (args.method) {
//     case "eth_getBlockByNumber": {
//       if (args.params[0] === "latest") {
//         latestBlockRequestCount += 1;
//         console.log("latest!");
//       }
//       return { kek: 123 };
//     }
//     default: {
//       throw new Error(`Unexpected RPC method call in test: ${args.method}`);
//     }
//   }
// };

const sendUsdcTransferTransaction = async () => {
  await walletClient.writeContract({
    ...usdcContractConfig,
    functionName: "transfer",
    args: [accounts[0].address, 1n],
    account: vitalik.account,
  });
};

test("setup() returns the finalized block number", async (context) => {
  const { store } = context;

  const service = new RealtimeSyncService({ store, logFilters, network });
  const { finalizedBlockNumber } = await service.setup();

  expect(finalizedBlockNumber).toEqual(16379995); // ANVIL_FORK_BLOCK - finalityBlockCount

  await service.kill();
});

test("backfills blocks from finalized to latest", async (context) => {
  const { store } = context;

  const service = new RealtimeSyncService({ store, logFilters, network });
  await service.setup();
  await service.start();
  await service.onIdle();

  const blocks = await store.db.selectFrom("blocks").selectAll().execute();
  expect(blocks).toHaveLength(5);
  blocks.forEach((block) => expect(Number(block.finalized)).toEqual(0));

  await service.kill();
});

test("backfills transactions from finalized to latest", async (context) => {
  const { store } = context;

  const service = new RealtimeSyncService({ store, logFilters, network });
  await service.setup();
  await service.start();
  await service.onIdle();

  const logs = await store.db.selectFrom("logs").selectAll().execute();
  const requiredTransactionHashes = new Set(logs.map((l) => l.transactionHash));

  const transactions = await store.db
    .selectFrom("transactions")
    .selectAll()
    .execute();

  expect(transactions.length).toEqual(requiredTransactionHashes.size);

  transactions.forEach((transaction) => {
    expect(Number(transaction.finalized)).toEqual(0);
    expect(requiredTransactionHashes.has(transaction.hash)).toEqual(true);
  });

  await service.kill();
});

test("backfills logs from finalized to latest", async (context) => {
  const { store } = context;

  const service = new RealtimeSyncService({ store, logFilters, network });
  await service.setup();
  await service.start();
  await service.onIdle();

  expect(service.metrics.blocks).toMatchObject({
    16379996: {
      bloom: { hit: true, falsePositive: false },
      matchedLogCount: 18,
    },
    16379997: {
      bloom: { hit: true, falsePositive: false },
      matchedLogCount: 32,
    },
    16379998: {
      bloom: { hit: true, falsePositive: false },
      matchedLogCount: 7,
    },
    16379999: {
      bloom: { hit: true, falsePositive: false },
      matchedLogCount: 9,
    },
    16380000: {
      bloom: { hit: true, falsePositive: false },
      matchedLogCount: 13,
    },
  });

  const logs = await store.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(79);
  logs.forEach((log) => {
    expect(Number(log.finalized)).toEqual(0);
    expect(log.address).toEqual(usdcContractConfig.address);
  });

  await service.kill();
});

test("handles new blocks", async (context) => {
  const { store } = context;

  const service = new RealtimeSyncService({ store, logFilters, network });
  await service.setup();
  await service.start();

  await sendUsdcTransferTransaction();
  await testClient.mine({ blocks: 1 });
  await service.addNewLatestBlock();

  await testClient.mine({ blocks: 1 });
  await service.addNewLatestBlock();

  await sendUsdcTransferTransaction();
  await sendUsdcTransferTransaction();
  await testClient.mine({ blocks: 1 });
  await service.addNewLatestBlock();

  await service.onIdle();

  expect(service.metrics.blocks).toMatchObject({
    // ... previous blocks omitted for brevity
    16380000: {
      bloom: { hit: true, falsePositive: false },
      matchedLogCount: 13,
    },
    16380001: {
      bloom: { hit: true, falsePositive: false },
      matchedLogCount: 1,
    },
    16380002: {
      bloom: { hit: false, falsePositive: false },
      matchedLogCount: 0,
    },
    16380003: {
      bloom: { hit: true, falsePositive: false },
      matchedLogCount: 2,
    },
  });

  const blocks = await store.db.selectFrom("blocks").selectAll().execute();
  expect(blocks).toHaveLength(7);
  blocks.forEach((block) => expect(Number(block.finalized)).toEqual(0));

  await service.kill();
});

test("emits realtimeCheckpoint events", async (context) => {
  const { store } = context;

  const service = new RealtimeSyncService({ store, logFilters, network });
  const emitSpy = vi.spyOn(service, "emit");

  await service.setup();
  await service.start();

  // Mine 8 blocks, which should trigger the finality checkpoint (after 5).
  for (const _ in range(0, 8)) {
    await sendUsdcTransferTransaction();
    await testClient.mine({ blocks: 1 });
  }

  await service.addNewLatestBlock();
  await service.onIdle();

  expect(emitSpy).toHaveBeenCalledWith("realtimeCheckpoint", {
    timestamp: 1673397023, // Timestamp of 16379995
  });
  expect(emitSpy).toHaveBeenCalledWith("realtimeCheckpoint", {
    timestamp: 1673397071, // Timestamp of 16380000
  });
  expect(emitSpy).toHaveBeenCalledWith("realtimeCheckpoint", {
    timestamp: 1673397078, // Timestamp of 16380008 (1s block time via Anvil)
  });

  await service.kill();
});

test("marks block data as finalized", async (context) => {
  const { store } = context;

  const service = new RealtimeSyncService({ store, logFilters, network });
  const emitSpy = vi.spyOn(service, "emit");

  const { finalizedBlockNumber: originalFinalizedBlockNumber } =
    await service.setup();
  await service.start();

  // Mine 8 blocks, which should trigger the finality checkpoint (after 5).
  for (const _ in range(0, 8)) {
    await sendUsdcTransferTransaction();
    await testClient.mine({ blocks: 1 });
  }

  await service.addNewLatestBlock();
  await service.onIdle();

  const blocks = await store.db.selectFrom("blocks").selectAll().execute();
  blocks.forEach((block) => {
    if (Number(block.number) <= originalFinalizedBlockNumber + 5) {
      expect(Number(block.finalized)).toEqual(1);
    } else {
      expect(Number(block.finalized)).toEqual(0);
    }
  });

  expect(emitSpy).toHaveBeenCalledWith("finalityCheckpoint", {
    timestamp: 1673397071, // Timestamp of 16380000
  });

  await service.kill();
});

test("handles 1 block shallow reorg", async (context) => {
  const { store } = context;

  const service = new RealtimeSyncService({ store, logFilters, network });
  await service.setup();
  await service.start();

  // Take a snapshot of the chain at the original block height.
  const originalSnapshotId = await testClient.snapshot();

  // Mine 3 blocks, each containing a transaction.
  for (const _ in range(0, 3)) {
    await sendUsdcTransferTransaction();
    await testClient.mine({ blocks: 1 });
  }
  // Allow the service to process the new blocks.
  await service.addNewLatestBlock();
  await service.onIdle();

  expect(service.metrics.blocks).toMatchObject({
    // ... previous blocks omitted for brevity
    16380001: {
      bloom: { hit: true, falsePositive: false },
      matchedLogCount: 1,
    },
    16380002: {
      bloom: { hit: true, falsePositive: false },
      matchedLogCount: 1,
    },
    16380003: {
      bloom: { hit: true, falsePositive: false },
      matchedLogCount: 1,
    },
  });

  // Now, revert to the original snapshot and mine one empty block.
  await testClient.revert({ id: originalSnapshotId });
  await testClient.mine({ blocks: 1 });

  // Allow the service to process the new block, detecting a reorg.
  await service.addNewLatestBlock();
  await service.onIdle();

  expect(service.metrics.blocks).toMatchObject({
    // ... previous blocks omitted for brevity
    16380001: {
      bloom: { hit: false, falsePositive: false },
      matchedLogCount: 0,
    },
  });

  await service.kill();
});

test("handles 3 block shallow reorg", async (context) => {
  const { store } = context;

  const service = new RealtimeSyncService({ store, logFilters, network });
  const emitSpy = vi.spyOn(service, "emit");

  await service.setup();
  await service.start();

  // Take a snapshot of the chain at the original block height.
  const originalSnapshotId = await testClient.snapshot();

  // Mine 3 blocks, each containing a transaction.
  for (const _ in range(0, 3)) {
    await sendUsdcTransferTransaction();
    await testClient.mine({ blocks: 1 });
  }
  // Allow the service to process the new blocks.
  await service.addNewLatestBlock();
  await service.onIdle();

  expect(service.metrics.blocks).toMatchObject({
    // ... previous blocks omitted for brevity
    16380001: {
      bloom: { hit: true, falsePositive: false },
      matchedLogCount: 1,
    },
    16380002: {
      bloom: { hit: true, falsePositive: false },
      matchedLogCount: 1,
    },
    16380003: {
      bloom: { hit: true, falsePositive: false },
      matchedLogCount: 1,
    },
  });

  // Now, revert to the original snapshot and mine 5 blocks, each containing 2 transactions.
  await testClient.revert({ id: originalSnapshotId });
  for (const _ in range(0, 5)) {
    await sendUsdcTransferTransaction();
    await sendUsdcTransferTransaction();
    await testClient.mine({ blocks: 1 });
  }

  // Allow the service to process the new block, detecting a reorg.
  await service.addNewLatestBlock();
  await service.onIdle();

  expect(service.metrics.blocks).toMatchObject({
    // ... previous blocks omitted for brevity
    16380001: {
      bloom: { hit: true, falsePositive: false },
      matchedLogCount: 2,
    },
    16380002: {
      bloom: { hit: true, falsePositive: false },
      matchedLogCount: 2,
    },
    16380003: {
      bloom: { hit: true, falsePositive: false },
      matchedLogCount: 2,
    },
    16380004: {
      bloom: { hit: true, falsePositive: false },
      matchedLogCount: 2,
    },
    16380005: {
      bloom: { hit: true, falsePositive: false },
      matchedLogCount: 2,
    },
  });

  expect(emitSpy).toHaveBeenCalledWith("shallowReorg", {
    commonAncestorTimestamp: 1673397071, // Timestamp of 16380000
  });

  await service.kill();
});

test("handles deep reorg", async (context) => {
  const { store } = context;

  const service = new RealtimeSyncService({ store, logFilters, network });
  const emitSpy = vi.spyOn(service, "emit");

  await service.setup();
  await service.start();

  // Take a snapshot of the chain at the original block height.
  const originalSnapshotId = await testClient.snapshot();

  // Mine 13 blocks, each containing a transaction.
  for (const _ in range(0, 13)) {
    await sendUsdcTransferTransaction();
    await testClient.mine({ blocks: 1 });
  }
  // Allow the service to process the new blocks.
  await service.addNewLatestBlock();
  await service.onIdle();

  // Confirm that the service has finalized blocks.
  expect(emitSpy).toHaveBeenCalledWith("finalityCheckpoint", {
    timestamp: 1673397076, // Timestamp of 16380005
  });

  // Now, revert to the original snapshot and mine 13 blocks, each containing 2 transactions.
  await testClient.revert({ id: originalSnapshotId });
  for (const _ in range(0, 13)) {
    await sendUsdcTransferTransaction();
    await sendUsdcTransferTransaction();
    await testClient.mine({ blocks: 1 });
  }

  // Allow the service to process the new block, detecting a reorg.
  await service.addNewLatestBlock();
  await service.onIdle();

  // The current finalized block number is 16380005, so the reorg is at least 8 blocks deep.
  expect(emitSpy).toHaveBeenCalledWith("deepReorg", {
    detectedAtBlockNumber: 16380013,
    minimumDepth: 8,
  });

  await service.kill();
});
