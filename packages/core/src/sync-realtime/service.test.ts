/* eslint-disable @typescript-eslint/no-unused-vars */
import { type EIP1193RequestFn, HttpRequestError, parseAbi } from "viem";
import { rpc } from "viem/utils";
import { beforeEach, expect, test, vi } from "vitest";

import {
  accounts,
  uniswapV3PoolFactoryConfig,
  usdcContractConfig,
  vitalik,
} from "@/_test/constants.js";
import { resetTestClient, setupSyncStore } from "@/_test/setup.js";
import { publicClient, testClient, walletClient } from "@/_test/utils.js";
import type { Network } from "@/config/networks.js";
import type { Source } from "@/config/sources.js";
import { decodeToBigInt } from "@/utils/encoding.js";
import { range } from "@/utils/range.js";

import { RealtimeSyncService } from "./service.js";

beforeEach((context) => setupSyncStore(context));
beforeEach(resetTestClient);

const network: Network = {
  name: "mainnet",
  chainId: 1,
  request: (options) =>
    rpc.http(publicClient.chain.rpcUrls.default.http[0], options),
  url: publicClient.chain.rpcUrls.default.http[0],
  pollingInterval: 1_000,
  defaultMaxBlockRange: 3,
  finalityBlockCount: 5,
  maxRpcRequestConcurrency: 10,
};

const rpcRequestSpy = vi.spyOn(
  network as { request: EIP1193RequestFn },
  "request",
);

const usdcLogFilter = {
  ...usdcContractConfig,
  id: `USDC_${network.name}`,
  contractName: "USDC",
  networkName: network.name,
  criteria: { address: usdcContractConfig.address },
  startBlock: 16369995, // 5 blocks
  maxBlockRange: 3,
  type: "logFilter",
} satisfies Source;

const sendUsdcTransferTransaction = async () => {
  await walletClient.writeContract({
    account: vitalik.account,
    address: usdcContractConfig.address,
    abi: usdcContractConfig.abi,
    functionName: "transfer",
    args: [accounts[0].address, 1n],
  });
};

const uniswapV3Factory = {
  ...uniswapV3PoolFactoryConfig,
  id: `UniswapV3Factory_${network.name}`,
  contractName: "UniswapV3Factory",
  networkName: network.name,
  startBlock: 16369500, // 500 blocks
  type: "factory",
} satisfies Source;

const createAndInitializeUniswapV3Pool = async () => {
  await walletClient.writeContract({
    account: vitalik.account,
    address: uniswapV3Factory.criteria.address,
    abi: [
      {
        inputs: [
          { internalType: "address", name: "tokenA", type: "address" },
          { internalType: "address", name: "tokenB", type: "address" },
          { internalType: "uint24", name: "fee", type: "uint24" },
        ],
        name: "createPool",
        outputs: [{ internalType: "address", name: "pool", type: "address" }],
        stateMutability: "nonpayable",
        type: "function",
      } as const,
    ],
    functionName: "createPool",
    args: [
      // ENS https://etherscan.io/token/0xc18360217d8f7ab5e7c516566761ea12ce7f9d72
      "0xc18360217d8f7ab5e7c516566761ea12ce7f9d72",
      // Dingo https://etherscan.io/token/0x1f961BCEAEF8eDF6fb2797C0293FfBDe3E994614
      "0x1f961BCEAEF8eDF6fb2797C0293FfBDe3E994614",
      500,
    ],
  });

  // Small hack - the pool gets deterministically created at this address.
  await walletClient.writeContract({
    account: vitalik.account,
    address: "0x25e0870d42b6cef90b6dc8216588fad55d5f55c4",
    abi: parseAbi(["function initialize(uint160 sqrtPriceX96)"]),
    functionName: "initialize",
    args: [93739913940949312680865654n],
  });
};

test("setup() returns block numbers", async (context) => {
  const { common, syncStore } = context;

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network,
    sources: [usdcLogFilter],
  });

  const { latestBlockNumber, finalizedBlockNumber } = await service.setup();

  expect(latestBlockNumber).toEqual(16380000); // ANVIL_FORK_BLOCK
  expect(finalizedBlockNumber).toEqual(16379995); // ANVIL_FORK_BLOCK - finalityBlockCount

  await service.kill();
});

test("start() adds blocks to the store from finalized to latest", async (context) => {
  const { common, syncStore } = context;

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network,
    sources: [usdcLogFilter],
  });

  await service.setup();
  await service.start();
  await service.onIdle();

  const blocks = await syncStore.db.selectFrom("blocks").selectAll().execute();
  expect(blocks).toHaveLength(5);
  expect(blocks.map((block) => decodeToBigInt(block.number))).toMatchObject([
    16379996n,
    16379997n,
    16379998n,
    16379999n,
    16380000n,
  ]);

  await service.kill();
});

test("start() adds all required transactions to the store", async (context) => {
  const { common, syncStore } = context;

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network,
    sources: [usdcLogFilter],
  });

  await service.setup();
  await service.start();
  await service.onIdle();

  const logs = await syncStore.db.selectFrom("logs").selectAll().execute();
  const requiredTransactionHashes = new Set(logs.map((l) => l.transactionHash));

  const transactions = await syncStore.db
    .selectFrom("transactions")
    .selectAll()
    .execute();

  expect(transactions.length).toEqual(requiredTransactionHashes.size);
  transactions.forEach((transaction) => {
    expect(requiredTransactionHashes.has(transaction.hash)).toEqual(true);
  });

  await service.kill();
});

test("start() adds all matched logs to the store", async (context) => {
  const { common, syncStore } = context;

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network,
    sources: [usdcLogFilter],
  });

  await service.setup();
  await service.start();
  await service.onIdle();

  const logs = await syncStore.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(79);
  logs.forEach((log) => {
    expect(log.address).toEqual(usdcContractConfig.address);
  });

  await service.kill();
});

test("start() handles new blocks", async (context) => {
  const { common, syncStore } = context;

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network,
    sources: [usdcLogFilter],
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

  const blocks = await syncStore.db.selectFrom("blocks").selectAll().execute();
  expect(blocks).toHaveLength(7);

  expect(blocks.map((block) => decodeToBigInt(block.number))).toMatchObject([
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

test("start() handles error while fetching new latest block gracefully", async (context) => {
  const { common, syncStore } = context;

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network,
    sources: [usdcLogFilter],
  });

  await service.setup();
  await service.start();

  await sendUsdcTransferTransaction();
  await testClient.mine({ blocks: 1 });

  // Mock a failed new block request.
  rpcRequestSpy.mockRejectedValueOnce(
    new HttpRequestError({ url: "http://test.com" }),
  );
  await service.addNewLatestBlock();

  // Now, this one should succeed.
  await service.addNewLatestBlock();

  await service.onIdle();

  const blocks = await syncStore.db.selectFrom("blocks").selectAll().execute();
  expect(blocks).toHaveLength(6);
  expect(blocks.map((block) => decodeToBigInt(block.number))).toMatchObject([
    16379996n,
    16379997n,
    16379998n,
    16379999n,
    16380000n,
    16380001n,
  ]);

  await service.kill();
});

test("start() emits realtimeCheckpoint events", async (context) => {
  const { common, syncStore } = context;

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network,
    sources: [usdcLogFilter],
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
    blockNumber: 16379996,
    blockTimestamp: 1673397023,
  });
  expect(emitSpy).toHaveBeenCalledWith("realtimeCheckpoint", {
    blockNumber: 16380000,
    blockTimestamp: 1673397071,
  });
  expect(emitSpy).toHaveBeenCalledWith("realtimeCheckpoint", {
    blockNumber: 16380008,
    // Anvil messes with the block number for blocks mined locally.
    blockTimestamp: expect.any(Number),
  });

  await service.kill();
});

test("start() inserts log filter interval records for finalized blocks", async (context) => {
  const { common, syncStore } = context;

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network,
    sources: [usdcLogFilter],
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

  const logFilterIntervals = await syncStore.getLogFilterIntervals({
    chainId: network.chainId,
    logFilter: usdcLogFilter.criteria,
  });
  expect(logFilterIntervals).toMatchObject([[16379996, 16380000]]);

  expect(emitSpy).toHaveBeenCalledWith("finalityCheckpoint", {
    blockNumber: 16380000,
    blockTimestamp: expect.any(Number),
  });

  await service.kill();
});

test("start() deletes data from the store after 3 block shallow reorg", async (context) => {
  const { common, syncStore } = context;

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network,
    sources: [usdcLogFilter],
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

  const blocks = await syncStore.db.selectFrom("blocks").selectAll().execute();
  expect(blocks.map((block) => decodeToBigInt(block.number))).toMatchObject([
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

  const blocksAfterReorg = await syncStore.db
    .selectFrom("blocks")
    .selectAll()
    .execute();
  expect(
    blocksAfterReorg.map((block) => decodeToBigInt(block.number)),
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

test("start() emits shallowReorg event after 3 block shallow reorg", async (context) => {
  const { common, syncStore } = context;

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network,
    sources: [usdcLogFilter],
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
    commonAncestorBlockTimestamp: 1673397071, // Timestamp of 16380000
  });

  await service.kill();
});

test("emits deepReorg event after deep reorg", async (context) => {
  const { common, syncStore } = context;

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network,
    sources: [usdcLogFilter],
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
    blockNumber: 16380000,
    blockTimestamp: expect.any(Number),
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

test("start() with factory contract inserts new child contracts records and child contract events", async (context) => {
  const { common, syncStore } = context;

  const service = new RealtimeSyncService({
    common,
    syncStore,
    network,
    sources: [uniswapV3Factory],
  });

  await service.setup();
  await service.start();

  await createAndInitializeUniswapV3Pool();
  await testClient.mine({ blocks: 1 });

  await service.addNewLatestBlock();
  await service.onIdle();

  const iterator = syncStore.getFactoryChildAddresses({
    chainId: uniswapV3Factory.chainId,
    factory: uniswapV3Factory.criteria,
    upToBlockNumber: 16380010n,
  });

  const childContractAddresses = [];
  for await (const page of iterator) childContractAddresses.push(...page);

  expect(childContractAddresses).toMatchObject([
    "0x25e0870d42b6cef90b6dc8216588fad55d5f55c4",
  ]);

  const eventIterator = syncStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: Number.MAX_SAFE_INTEGER,
    factories: [
      {
        id: "UniswapV3Pool",
        chainId: network.chainId,
        criteria: uniswapV3Factory.criteria,
      },
    ],
  });
  const events = [];
  for await (const page of eventIterator) events.push(...page.events);

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject(
    expect.objectContaining({
      sourceId: "UniswapV3Pool",
      log: expect.objectContaining({
        address: "0x25e0870d42b6cef90b6dc8216588fad55d5f55c4",
      }),
    }),
  );

  await service.kill();
});
