import { accounts, usdcContractConfig, vitalik } from "test/utils/constants";
import { expectEvents } from "test/utils/expectEvents";
import { publicClient, testClient, walletClient } from "test/utils/utils";
import { PublicClient, RpcBlock } from "viem";
import { PublicRequests } from "viem/dist/types/types/eip1193";
import { expect, test, vi } from "vitest";

import { encodeLogFilterKey } from "@/config/encodeLogFilterKey";
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
    startBlock: 16369950,
    // Note: the service uses the `finalizedBlockNumber` as the end block if undefined.
    endBlock: undefined,
    maxBlockRange: network.defaultMaxBlockRange,
    filter: {
      key: encodeLogFilterKey({
        chainId: network.chainId,
        address: usdcContractConfig.address,
      }),
      address: usdcContractConfig.address,
    },
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

// spy.mockImplementationOnce(impl);

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
});

test("marks block data as finalized", async (context) => {
  const { store } = context;

  const service = new RealtimeSyncService({ store, logFilters, network });
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
});
