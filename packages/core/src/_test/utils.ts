import type {
  BlockTag,
  Chain,
  Hash,
  Hex,
  RpcBlock,
  RpcTransaction,
} from "viem";
import {
  checksumAddress,
  createPublicClient,
  createTestClient,
  createWalletClient,
  getAbiItem,
  getEventSelector,
  http,
  slice,
  toHex,
} from "viem";
import { mainnet } from "viem/chains";

import { type Config, createConfig } from "@/config/config.js";
import { buildNetwork } from "@/config/networks.js";
import { buildSources, type Source } from "@/config/sources.js";
import type { Common } from "@/Ponder.js";
import type { Checkpoint } from "@/utils/checkpoint.js";

import { ALICE } from "./constants.js";
import { erc20ABI, factoryABI, pairABI } from "./generated.js";
import type { deploy } from "./simulate.js";

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

export const getConfig = (
  addresses: Awaited<ReturnType<typeof deploy>>,
): Config =>
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
        address: addresses.erc20Address,
      },
      Pair: {
        abi: pairABI,
        network: "mainnet",
        factory: {
          address: addresses.factoryAddress,
          event: getAbiItem({ abi: factoryABI, name: "PairCreated" }),
          parameter: "pair",
        },
      },
    },
  });

export const getNetworks = async () => {
  const network = await buildNetwork({
    networkName: "mainnet",
    network: { chainId: 1, transport: http(`http://127.0.0.1:8545/${poolId}`) },
    common: { logger: { warn: () => {} } } as unknown as Common,
  });

  return [{ ...network, finalityBlockCount: 4 }];
};

export const getSources = (
  addresses: Awaited<ReturnType<typeof deploy>>,
): Source[] => buildSources({ config: getConfig(addresses) });

export const getEvents = async (sources: Source[]) => {
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

  return sources
    .map((source) =>
      logs
        .filter((l) => l.sourceId === source.id)
        .map(({ log }) => {
          const block = blocks.find((b) => b.number === log.blockNumber)!;
          const transaction = transactions.find(
            (tx) => tx.hash === log.transactionHash,
          )!;
          return {
            sourceId: source.id,
            chainId: source.chainId,
            log: {
              ...log,
              id: `${log.blockHash}-${toHex(log.logIndex)}`,
              address: checksumAddress(log.address),
            },
            block: { ...block, miner: checksumAddress(block.miner) },
            transaction: {
              ...transaction,
              to: transaction.to ? checksumAddress(transaction.to) : null,
              from: transaction.from ? checksumAddress(transaction.from) : null,
            },
          };
        }),
    )
    .flat();
};

export const getEventsErc20 = async (sources: Source[]) => {
  const events = await getEvents(sources);

  async function* _getEvents({ toCheckpoint }: { toCheckpoint: Checkpoint }) {
    yield {
      events: [events[0], events[1]],
      metadata: {
        pageEndCheckpoint: toCheckpoint,
        // TODO:Kyle make this programmatic
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

  return _getEvents;
};

export const getRawEvents = async (sources: Source[]) => {
  const latestBlock = await publicClient.getBlockNumber();
  const logs = (
    await Promise.all(
      sources.map((source) =>
        publicClient.request({
          method: "eth_getLogs",
          params: [
            {
              address: source.criteria.address,
              fromBlock: toHex(latestBlock - 3n),
            },
          ],
        }),
      ),
    )
  ).flat();

  // Manually add the child address log
  logs.push(
    ...(await publicClient.request({
      method: "eth_getLogs",
      params: [
        {
          address: slice(logs[2].topics[1]!, 12),
          fromBlock: toHex(latestBlock - 3n),
        },
      ],
    })),
  );

  // Dedupe any repeated blocks and txs
  const blockNumbers: Set<Hex> = new Set();
  const txHashes: Set<Hash> = new Set();
  for (const log of logs) {
    if (log.blockNumber) blockNumbers.add(log.blockNumber);
    if (log.transactionHash) txHashes.add(log.transactionHash);
  }
  const blocks = await Promise.all(
    [...blockNumbers].map((bn) =>
      publicClient.request({
        method: "eth_getBlockByNumber",
        params: [bn, true],
      }),
    ),
  );

  return logs.map((log) => {
    const block = blocks.find((b) => b!.number === log.blockNumber)!;

    return {
      log,
      block: block as RpcBlock<BlockTag, true>,
      transaction: block.transactions[
        Number(log.transactionIndex!)
      ] as RpcTransaction,
    };
  });
};

// getEvents spoof
