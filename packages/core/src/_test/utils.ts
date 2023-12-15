import type { Address, Chain, Hash } from "viem";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  getAbiItem,
  getEventSelector,
  http,
} from "viem";
import { mainnet } from "viem/chains";

import { type Config, createConfig } from "@/config/config.js";
import { buildNetwork } from "@/config/networks.js";
import { buildSources, type Source } from "@/config/sources.js";
import type { Common } from "@/Ponder.js";
import type { Checkpoint } from "@/utils/checkpoint.js";

import { ALICE } from "./constants.js";
import { erc20ABI } from "./generated.js";

// Anvil test setup adapted from @viem/anvil `example-vitest` repository.
// https://github.com/wagmi-dev/anvil.js/tree/main/examples/example-vitest

// ID of the current test worker. Used by the `@viem/anvil` proxy server.
export const poolId = Number(process.env.VITEST_POOL_ID ?? 1);

export const anvil = {
  ...mainnet, // We are using a mainnet fork for testing.
  id: 1, // We configured our anvil instance to use `1` as the chain id (see `globalSetup.ts`);
  rpcUrls: {
    default: {
      http: [`http://127.0.0.1:8545/${poolId}`],
      webSocket: [`ws://127.0.0.1:8545/${poolId}`],
    },
    public: {
      http: [`http://127.0.0.1:8545/${poolId}`],
      webSocket: [`ws://127.0.0.1:8545/${poolId}`],
    },
  },
} as const satisfies Chain;

export const testClient = createTestClient({
  chain: anvil,
  mode: "anvil",
  transport: http(),
});

export const publicClient = createPublicClient({
  chain: anvil,
  transport: http(),
});

export const walletClient = createWalletClient({
  chain: anvil,
  transport: http(),
  account: ALICE,
});

export const getConfig = (erc20Address: Address): Config =>
  createConfig({
    networks: {
      mainnet: {
        chainId: 1,
        transport: http(`http://127.0.0.1:8545/${poolId}`),
      },
    },
    contracts: {
      Erc20: {
        abi: erc20ABI,
        network: "mainnet",
        address: erc20Address,
      },
    },
  });

export const getNetworks = async () => [
  await buildNetwork({
    networkName: "mainnet",
    network: { chainId: 1, transport: http(`http://127.0.0.1:8545/${poolId}`) },
    common: { logger: { warn: () => {} } } as unknown as Common,
  }),
];

export const getSources = (erc20Address: Address): Source[] =>
  buildSources({ config: getConfig(erc20Address) });

export const getEventsHelper = async (sources: Source[]) => {
  const logs = (
    await Promise.all(
      sources.map((source) =>
        publicClient
          .getLogs({
            address: source.criteria.address,
            fromBlock: "earliest",
            toBlock: "latest",
          })
          .then((logs) => logs.map((log) => ({ sourceId: source.id, log }))),
      ),
    )
  ).flat();

  // Dedupe any repeated blocks and txs
  const blockNumbers: Set<bigint> = new Set();
  const txHashes: Set<Hash> = new Set();
  for (const { log } of logs) {
    if (log.blockNumber) blockNumbers.add(log.blockNumber);
    txHashes.add(log.transactionHash);
  }
  const blocks = await Promise.all(
    [...blockNumbers].map((bn) =>
      publicClient.getBlock({
        blockNumber: bn,
      }),
    ),
  );
  const transactions = await Promise.all(
    [...txHashes].map((txHash) =>
      publicClient.getTransaction({
        hash: txHash,
      }),
    ),
  );

  const events = sources
    .map((source) =>
      logs
        .filter((l) => l.sourceId === source.id)
        .map(({ log }) => ({
          sourceId: source.id,
          chainId: source.chainId,
          log: { ...log, id: `${log.blockHash}-${log.logIndex}` },
          block: blocks.find((b) => b.number === log.blockNumber)!,
          transaction: transactions.find(
            (tx) => tx.hash === log.transactionHash,
          )!,
        })),
    )
    .flat();

  async function* getEvents({ toCheckpoint }: { toCheckpoint: Checkpoint }) {
    yield {
      events,
      metadata: {
        pageEndCheckpoint: toCheckpoint,
        counts: [
          {
            sourceId: "Erc20_mainnet",
            selector: getEventSelector(
              getAbiItem({
                abi: erc20ABI,
                name: "Transfer",
              }),
            ),
            count: 5,
          },
        ],
      },
    };
  }

  return getEvents;
};
