import { accounts, usdcContractConfig, vitalik } from "test/utils/constants";
import { expectEvents } from "test/utils/expectEvents";
import { publicClient, testClient, walletClient } from "test/utils/utils";
import { PublicClient, RpcBlock } from "viem";
import { PublicRequests } from "viem/dist/types/types/eip1193";
import { beforeEach, expect, test, vi } from "vitest";

import { encodeLogFilterKey } from "@/config/encodeLogFilterKey";
import { LogFilter } from "@/config/logFilters";
import { Network } from "@/config/networks";
import { wait } from "@/utils/wait";

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

beforeEach(async () => {
  await testClient.impersonateAccount({ address: vitalik.address });
  // await testClient.setAutomine(true);
});

test("setup() returns the finalized block number", async (context) => {
  const { store } = context;

  const service = new RealtimeSyncService({ store, logFilters, network });
  const { finalizedBlockNumber } = await service.setup();

  expect(finalizedBlockNumber).toEqual(16379995); // ANVIL_FORK_BLOCK - finalityBlockCount
});

test("start() backfills blocks", async (context) => {
  const { store } = context;

  const service = new RealtimeSyncService({ store, logFilters, network });
  await service.setup();
  await service.start();
  await service.onIdle();

  const blocks = await store.db.selectFrom("blocks").selectAll().execute();
  expect(blocks).toHaveLength(5);
  blocks.forEach((block) => {
    expect(Number(block.finalized)).toEqual(0);
  });
});

test("start() backfills transactions", async (context) => {
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

test("start() backfills logs", async (context) => {
  const { store } = context;

  const service = new RealtimeSyncService({ store, logFilters, network });
  await service.setup();
  await service.start();
  await service.onIdle();

  expect(service.metrics.blocks).toMatchObject({
    16379996: { matchedLogCount: 18 },
    16379997: { matchedLogCount: 32 },
    16379998: { matchedLogCount: 7 },
    16379999: { matchedLogCount: 9 },
    16380000: { matchedLogCount: 13 },
  });

  const logs = await store.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(79);
  logs.forEach((log) => {
    expect(Number(log.finalized)).toEqual(0);
    expect(log.address).toEqual(usdcContractConfig.address);
  });
});
