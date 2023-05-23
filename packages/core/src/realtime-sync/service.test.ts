import { accounts, usdcContractConfig, vitalik } from "test/utils/constants";
import { expectEvents } from "test/utils/expectEvents";
import { publicClient, testClient, walletClient } from "test/utils/utils";
import { PublicClient, RpcBlock } from "viem";
import { PublicRequests } from "viem/dist/types/types/eip1193";
import { beforeEach, expect, test, vi } from "vitest";

import { encodeLogFilterKey } from "@/config/encodeLogFilterKey";
import { LogFilter } from "@/config/logFilters";
import { Network } from "@/config/networks";

import { RealtimeSyncService } from "./service";

const network: Network = {
  name: "mainnet",
  chainId: 1,
  client: publicClient,
  pollingInterval: 1_000,
  defaultMaxBlockRange: 3,
  finalityBlockCount: 10,
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

test("setup() calculates cached and total block counts", async (context) => {
  const { store } = context;

  const service = new RealtimeSyncService({ store, logFilters, network });
  const { finalizedBlockNumber } = await service.setup();

  expect(finalizedBlockNumber).toEqual(16379990); // ANVIL_FORK_BLOCK - 10
});

test("start() calculates cached and total block counts", async (context) => {
  const { store } = context;

  await testClient.mine({ blocks: 5 });

  const service = new RealtimeSyncService({ store, logFilters, network });
  const { finalizedBlockNumber } = await service.setup();

  expect(finalizedBlockNumber).toEqual(16379990); // ANVIL_FORK_BLOCK - 10
});
