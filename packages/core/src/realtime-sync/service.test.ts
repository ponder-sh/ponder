/* eslint-disable @typescript-eslint/no-unused-vars */
import { type EIP1193RequestFn, HttpRequestError } from "viem";
import { beforeEach, expect, test, vi } from "vitest";

import { accounts, usdcContractConfig, vitalik } from "@/_test/constants";
import { resetTestClient, setupEventStore } from "@/_test/setup";
import { publicClient, testClient, walletClient } from "@/_test/utils";
import { encodeLogFilterKey } from "@/config/logFilterKey";
import type { LogFilter } from "@/config/logFilters";
import type { Network } from "@/config/networks";
import { blobToBigInt } from "@/utils/decode";
import { range } from "@/utils/range";

import { RealtimeSyncService } from "./service";

beforeEach((context) => setupEventStore(context));
beforeEach(async () => await resetTestClient());

const network: Network = {
  name: "mainnet",
  chainId: 1,
  client: publicClient,
  pollingInterval: 1_000,
  defaultMaxBlockRange: 3,
  finalityBlockCount: 5,
  maxRpcRequestConcurrency: 10,
};

const rpcRequestSpy = vi.spyOn(
  network.client as { request: EIP1193RequestFn },
  "request"
);

const logFilters: LogFilter[] = [
  {
    name: "USDC",
    ...usdcContractConfig,
    network: network.name,
    filter: {
      key: encodeLogFilterKey({
        chainId: network.chainId,
        address: usdcContractConfig.address,
      }),
      chainId: network.chainId,
      address: usdcContractConfig.address,
      startBlock: 16369950,
      // Note: the service uses the `finalizedBlockNumber` as the end block if undefined.
      endBlock: undefined,
    },
  },
];

const sendUsdcTransferTransaction = async () => {
  await walletClient.writeContract({
    ...usdcContractConfig,
    functionName: "transfer",
    args: [accounts[0].address, 1n],
    account: vitalik.account,
  });
};

test("setup() returns block numbers", async (context) => {
  const { common, eventStore } = context;

  const service = new RealtimeSyncService({
    common,
    eventStore,
    logFilters,
    network,
  });

  const { latestBlockNumber, finalizedBlockNumber } = await service.setup();

  expect(latestBlockNumber).toEqual(16380000); // ANVIL_FORK_BLOCK
  expect(finalizedBlockNumber).toEqual(16379995); // ANVIL_FORK_BLOCK - finalityBlockCount

  await service.kill();
});

test("adds blocks to the store from finalized to latest", async (context) => {
  const { common, eventStore } = context;

  const service = new RealtimeSyncService({
    common,
    eventStore,
    logFilters,
    network,
  });

  await service.setup();
  await service.start();
  await service.onIdle();

  const blocks = await eventStore.db.selectFrom("blocks").selectAll().execute();
  expect(blocks).toHaveLength(5);
  expect(blocks.map((block) => blobToBigInt(block.number))).toMatchObject([
    16379996n,
    16379997n,
    16379998n,
    16379999n,
    16380000n,
  ]);

  await service.kill();
});

test("adds all required transactions to the store", async (context) => {
  const { common, eventStore } = context;

  const service = new RealtimeSyncService({
    common,
    eventStore,
    logFilters,
    network,
  });

  await service.setup();
  await service.start();
  await service.onIdle();

  const logs = await eventStore.db.selectFrom("logs").selectAll().execute();
  const requiredTransactionHashes = new Set(logs.map((l) => l.transactionHash));

  const transactions = await eventStore.db
    .selectFrom("transactions")
    .selectAll()
    .execute();

  expect(transactions.length).toEqual(requiredTransactionHashes.size);
  transactions.forEach((transaction) => {
    expect(requiredTransactionHashes.has(transaction.hash)).toEqual(true);
  });

  await service.kill();
});

test("adds all matched logs to the store", async (context) => {
  const { common, eventStore } = context;

  const service = new RealtimeSyncService({
    common,
    eventStore,
    logFilters,
    network,
  });

  await service.setup();
  await service.start();
  await service.onIdle();

  const logs = await eventStore.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(79);
  logs.forEach((log) => {
    expect(log.address).toEqual(usdcContractConfig.address);
  });

  await service.kill();
});

test("handles new blocks", async (context) => {
  const { common, eventStore } = context;

  const service = new RealtimeSyncService({
    common,
    eventStore,
    logFilters,
    network,
  });

  await service.setup();
  await service.start();

  // Block 16380001 has 1 matched logs
  await sendUsdcTransferTransaction();
  await testClient.mine({ blocks: 1 });
  await service.addNewLatestBlock();

  // Block 16380002 has 0 matched logs
  await testClient.mine({ blocks: 1 });
  await service.addNewLatestBlock();

  // Block 16380003 has 3 matched logs
  await sendUsdcTransferTransaction();
  await sendUsdcTransferTransaction();
  await testClient.mine({ blocks: 1 });
  await service.addNewLatestBlock();

  await service.onIdle();

  const blocks = await eventStore.db.selectFrom("blocks").selectAll().execute();
  expect(blocks).toHaveLength(7);

  expect(blocks.map((block) => blobToBigInt(block.number))).toMatchObject([
    16379996n,
    16379997n,
    16379998n,
    16379999n,
    16380000n,
    16380001n,
    // 16380002n <- Not added to the store, because it has no matched logs.
    16380003n,
  ]);

  await service.kill();
});

test("handles error while fetching new latest block gracefully", async (context) => {
  const { common, eventStore } = context;

  const service = new RealtimeSyncService({
    common,
    eventStore,
    logFilters,
    network,
  });

  await service.setup();
  await service.start();

  await sendUsdcTransferTransaction();
  await testClient.mine({ blocks: 1 });

  // Mock a failed new block request.
  rpcRequestSpy.mockRejectedValueOnce(
    new HttpRequestError({ url: "http://test.com" })
  );
  await service.addNewLatestBlock();

  // Now, this one should succeed.
  await service.addNewLatestBlock();

  await service.onIdle();

  const blocks = await eventStore.db.selectFrom("blocks").selectAll().execute();
  expect(blocks).toHaveLength(6);
  expect(blocks.map((block) => blobToBigInt(block.number))).toMatchObject([
    16379996n,
    16379997n,
    16379998n,
    16379999n,
    16380000n,
    16380001n,
  ]);

  await service.kill();
});

test("emits realtimeCheckpoint events", async (context) => {
  const { common, eventStore } = context;

  const service = new RealtimeSyncService({
    common,
    eventStore,
    logFilters,
    network,
  });

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

test("inserts cached range records for finalized blocks", async (context) => {
  const { common, eventStore } = context;

  const service = new RealtimeSyncService({
    common,
    eventStore,
    logFilters,
    network,
  });

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

  const cachedRanges = await eventStore.getLogFilterCachedRanges({
    logFilterKey: logFilters[0].filter.key,
  });

  expect(cachedRanges).toMatchObject([
    {
      filterKey: '1-"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"-null',
      startBlock: 16379996,
      endBlock: 16380000,
      endBlockTimestamp: 1673397071,
    },
  ]);

  expect(emitSpy).toHaveBeenCalledWith("finalityCheckpoint", {
    timestamp: 1673397071, // Timestamp of 16380000
  });

  await service.kill();
});

test("removes data from the store after 3 block shallow reorg", async (context) => {
  const { common, eventStore } = context;

  const service = new RealtimeSyncService({
    common,
    eventStore,
    logFilters,
    network,
  });

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

  const blocks = await eventStore.db.selectFrom("blocks").selectAll().execute();
  expect(blocks.map((block) => blobToBigInt(block.number))).toMatchObject([
    16379996n,
    16379997n,
    16379998n,
    16379999n,
    16380000n,
    16380001n,
    16380002n,
    16380003n,
  ]);

  // Now, revert to the original snapshot.
  await testClient.revert({ id: originalSnapshotId });

  // Add one empty block (16380001).
  await testClient.mine({ blocks: 1 });

  // Add one block with one transaction (16380002).
  await sendUsdcTransferTransaction();
  await testClient.mine({ blocks: 1 });

  // Allow the service to process the new blocks.
  await service.addNewLatestBlock();
  await service.onIdle();

  const blocksAfterReorg = await eventStore.db
    .selectFrom("blocks")
    .selectAll()
    .execute();
  expect(
    blocksAfterReorg.map((block) => blobToBigInt(block.number))
  ).toMatchObject([
    16379996n,
    16379997n,
    16379998n,
    16379999n,
    16380000n,
    // 16380001n <- Not added to the store, because it has no matched logs.
    16380002n,
  ]);

  await service.kill();
});

test("emits shallowReorg event after 3 block shallow reorg", async (context) => {
  const { common, eventStore } = context;

  const service = new RealtimeSyncService({
    common,
    eventStore,
    logFilters,
    network,
  });

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

  // Now, revert to the original snapshot.
  await testClient.revert({ id: originalSnapshotId });
  await testClient.mine({ blocks: 1 });

  // Add one new empty block (16380001).
  await service.addNewLatestBlock();
  await service.onIdle();

  expect(emitSpy).toHaveBeenCalledWith("shallowReorg", {
    commonAncestorTimestamp: 1673397071, // Timestamp of 16380000
  });

  await service.kill();
});

test("emits deepReorg event after deep reorg", async (context) => {
  const { common, eventStore } = context;

  const service = new RealtimeSyncService({
    common,
    eventStore,
    logFilters,
    network,
  });

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

  expect(emitSpy).toHaveBeenCalledWith("finalityCheckpoint", {
    // Note that the precise number can change depending on how long it takes to
    // mine each block above.
    timestamp: expect.any(Number),
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
