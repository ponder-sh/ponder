import type { Common, Ponder } from "@/Ponder.js";
import { type Config, createConfig } from "@/config/config.js";
import { buildNetwork } from "@/config/networks.js";
import { type Source, buildSources } from "@/config/sources.js";
import type { Checkpoint } from "@/utils/checkpoint.js";
import type {
  BlockTag,
  Chain,
  Hash,
  Hex,
  RpcBlock,
  RpcLog,
  RpcTransaction,
} from "viem";
import {
  http,
  checksumAddress,
  createPublicClient,
  createTestClient,
  createWalletClient,
  formatBlock,
  formatLog,
  formatTransaction,
  getAbiItem,
  getEventSelector,
  slice,
  toHex,
} from "viem";
import { mainnet } from "viem/chains";
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

/**
 * Returns the config for the local anvil testing suite.
 * The suite contains an erc20 and mock factory + pair event sources.
 */
export const getConfig = (
  addresses: Awaited<ReturnType<typeof deploy>>,
): Config =>
  createConfig({
    networks: {
      mainnet: {
        chainId: 1,
        transport: http(`http://127.0.0.1:8545/${poolId}`),
        maxRequestsPerSecond: 1,
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

/**
 * Returns a network representing the local anvil chain.
 * Set `finalityBlockCount` to 4 because `deploy()` + `simulate()` is 4 blocks.
 */
export const getNetworks = async (
  common: Common,
  maxRequestsPerSecond = 100,
) => {
  const network = await buildNetwork({
    networkName: "mainnet",
    network: {
      chainId: 1,
      transport: http(`http://127.0.0.1:8545/${poolId}`),
      maxRequestsPerSecond,
    },
    common,
  });

  return [{ ...network, finalityBlockCount: 4 }];
};

export const getSources = (
  addresses: Awaited<ReturnType<typeof deploy>>,
): Source[] => buildSources({ config: getConfig(addresses) });

/**
 * Returns the logs, block, and transaction data for the blocks with events (1, 2, 3).
 * Block 1 has two erc20 transfer events.
 * Block 2 has a pair creation event.
 * Block 3 has a swap event from the newly created pair.
 */
export const getRawRPCData = async (sources: Source[]) => {
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

  return {
    block1: {
      logs: [logs[0]!, logs[1]!],
      block: blocks[0]!,
      transactions: blocks[0]!.transactions,
    },
    block2: {
      logs: [logs[2]],
      block: blocks[1],
      transactions: blocks[1]!.transactions,
    },
    block3: {
      logs: [logs[3]],
      block: blocks[2],
      transactions: blocks[2]!.transactions,
    },
  } as {
    block1: {
      logs: [RpcLog, RpcLog];
      block: RpcBlock<BlockTag, true>;
      transactions: [RpcTransaction, RpcTransaction];
    };
    block2: {
      logs: [RpcLog];
      block: RpcBlock<BlockTag, true>;
      transactions: [RpcTransaction];
    };
    block3: {
      logs: [RpcLog];
      block: RpcBlock<BlockTag, true>;
      transactions: [RpcTransaction];
    };
  };
};

/**
 * Mock function for `getLogEvents` that specifically returns the event data for the erc20 source.
 */
export const getEventsErc20 = async (sources: Source[]) => {
  const rpcData = await getRawRPCData(sources);

  async function* _getEvents({ toCheckpoint }: { toCheckpoint: Checkpoint }) {
    yield {
      events: [
        {
          log: rpcData.block1.logs[0],
          block: rpcData.block1.block,
          transaction: rpcData.block1.transactions[0]!,
        },
        {
          log: rpcData.block1.logs[1],
          block: rpcData.block1.block,
          transaction: rpcData.block1.transactions[1]!,
        },
      ]
        .map((e) => ({
          log: formatLog(e.log),
          block: formatBlock(e.block),
          transaction: formatTransaction(e.transaction),
        }))
        .map(({ log, block, transaction }) => ({
          sourceId: sources[0].id,
          chainId: sources[0].chainId,
          log: {
            ...log,
            id: `${log.blockHash}-${toHex(log.logIndex!)}`,
            address: checksumAddress(log.address),
          },
          block: { ...block, miner: checksumAddress(block.miner) },
          transaction: {
            ...transaction,
            from: checksumAddress(transaction.from),
            to: transaction.to
              ? checksumAddress(transaction.to)
              : transaction.to,
          },
        })),
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
            count: 2,
          },
        ],
      },
    };
  }

  return _getEvents;
};

/**
 * Returns a promise that resolves when all events are processed.
 */
export const onAllEventsIndexed = (ponder: Ponder) => {
  return new Promise<void>((resolve) => {
    ponder.indexingService.on("eventsProcessed", async ({ toCheckpoint }) => {
      if (
        toCheckpoint.blockNumber === Number(await publicClient.getBlockNumber())
      ) {
        resolve();
      }
    });
  });
};
