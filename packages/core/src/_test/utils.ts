import { type AddressInfo, createServer } from "node:net";
import { buildConfigAndIndexingFunctions } from "@/build/configAndIndexingFunctions.js";
import type { Common } from "@/common/common.js";
import { buildAbiFunctions } from "@/config/abi.js";
import { createConfig } from "@/config/config.js";
import {
  type EventSource,
  type FactorySource,
  type LogSource,
  sourceIsFactory,
  sourceIsLog,
} from "@/config/sources.js";
import type { RawEvent } from "@/sync-store/store.js";
import type { SyncTrace } from "@/sync/index.js";
import { encodeCheckpoint } from "@/utils/checkpoint.js";
import { createRequestQueue } from "@/utils/requestQueue.js";
import {
  type BlockTag,
  type Chain,
  type Hash,
  type Hex,
  type RpcBlock,
  type RpcLog,
  type RpcTransaction,
  type RpcTransactionReceipt,
  encodeFunctionData,
  encodeFunctionResult,
  formatTransactionReceipt,
  getFunctionSelector,
  hexToNumber,
  parseEther,
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
  slice,
  toHex,
} from "viem";
import { mainnet } from "viem/chains";
import { ALICE, BOB } from "./constants.js";
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
export const getConfig = (addresses: Awaited<ReturnType<typeof deploy>>) =>
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
        filter: {
          event: [
            "Transfer(address indexed from, address indexed to, uint256 amount)",
            "Approval",
          ],
        },
      },
      Pair: {
        abi: pairABI,
        network: "mainnet",
        factory: {
          address: addresses.factoryAddress,
          event: getAbiItem({ abi: factoryABI, name: "PairCreated" }),
          parameter: "pair",
        },
        filter: {
          event: ["Swap"],
        },
      },
    },
    blocks: {
      OddBlocks: {
        startBlock: 1,
        interval: 2,
        network: "mainnet",
      },
    },
  });

/**
 * Returns a network representing the local anvil chain.
 * Set `finalityBlockCount` to 4 because `deploy()` + `simulate()` is 4 blocks.
 */
export const getNetworkAndSources = async (
  addresses: Awaited<ReturnType<typeof deploy>>,
  common: Common,
) => {
  const config = getConfig(addresses);
  // TODO(kyle) update config with function call sources
  const { networks, sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [
      {
        name: "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)",
        fn: () => {},
      },
      { name: "Pair:Swap", fn: () => {} },
      { name: "OddBlocks:block", fn: () => {} },
    ],
    options: common.options,
  });
  const mainnet = { ...networks[0], finalityBlockCount: 4 };

  const requestQueue = createRequestQueue({
    network: networks[0],
    common,
  });

  return {
    networks: [mainnet],
    sources: [
      ...sources,
      {
        type: "function",
        id: "trace_Factory_mainnet",
        contractName: "Factory",
        networkName: "mainnet",
        chainId: 1,
        abi: factoryABI,
        abiFunctions: buildAbiFunctions({ abi: factoryABI }),
        startBlock: 0,
        criteria: {
          includeTransactionReceipts: false,
          functionSelectors: [
            getFunctionSelector(
              getAbiItem({ abi: factoryABI, name: "createPair" }),
            ),
          ],
        },
      },
    ],
    requestQueues: [requestQueue],
  };
};

/**
 * Returns the logs, block, and transaction data for the blocks with events (1, 2, 3).
 * Block 1 has two erc20 transfer events.
 * Block 2 has a pair creation event.
 * Block 3 has a swap event from the newly created pair.
 */
export const getRawRPCData = async (sources: EventSource[]) => {
  const latestBlock = await publicClient.getBlockNumber();
  const logs = (
    await Promise.all(
      sources
        .filter(
          (source): source is LogSource | FactorySource =>
            sourceIsLog(source) || sourceIsFactory(source),
        )
        .map((source) =>
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
  const transactionReceipts = await Promise.all(
    [...txHashes].map((tx) =>
      publicClient.request({
        method: "eth_getTransactionReceipt",
        params: [tx],
      }),
    ),
  );

  return {
    block1: {
      logs: [logs[0]!, logs[1]!],
      block: blocks[0]!,
      transactions: blocks[0]!.transactions,
      transactionReceipts: transactionReceipts.filter(
        (tr) => tr?.blockNumber === blocks[0]?.number,
      ),
      traces: [
        {
          action: {
            callType: "call",
            from: ALICE,
            gas: "0x0",
            input: encodeFunctionData({
              abi: erc20ABI,
              functionName: "mint",
              args: [ALICE, parseEther("1")],
            }),
            to: logs[0]!.address,
            value: "0x0",
          },
          blockHash: blocks[0]!.hash,
          blockNumber: blocks[0]!.number,
          result: {
            gasUsed: "0x0",
            output: encodeFunctionResult({
              abi: erc20ABI,
              functionName: "mint",
            }),
          },
          subtraces: 0,
          traceAddress: [0],
          transactionHash: logs[0]!.transactionHash!,
          transactionPosition: hexToNumber(logs[0]!.transactionIndex!),
          type: "call",
        },
        {
          action: {
            callType: "call",
            from: ALICE,
            gas: "0x0",
            input: encodeFunctionData({
              abi: erc20ABI,
              functionName: "mint",
              args: [BOB, parseEther("1")],
            }),
            to: logs[1]!.address,
            value: "0x0",
          },
          blockHash: blocks[0]!.hash,
          blockNumber: blocks[0]!.number,
          result: {
            gasUsed: "0x0",
            output: encodeFunctionResult({
              abi: erc20ABI,
              functionName: "mint",
            }),
          },
          subtraces: 0,
          traceAddress: [0],
          transactionHash: logs[1]!.transactionHash!,
          transactionPosition: hexToNumber(logs[1]!.transactionIndex!),
          type: "call",
        },
      ],
    },
    block2: {
      logs: [logs[2]],
      block: blocks[1]!,
      transactions: blocks[1]!.transactions,
      transactionReceipts: transactionReceipts.filter(
        (tr) => tr?.blockNumber === blocks[1]?.number,
      ),
      traces: [
        {
          action: {
            callType: "call",
            from: ALICE,
            gas: "0x0",
            input: encodeFunctionData({
              abi: factoryABI,
              functionName: "createPair",
            }),
            to: logs[2]!.address,
            value: "0x0",
          },
          blockHash: blocks[1]!.hash,
          blockNumber: blocks[1]!.number,
          result: {
            gasUsed: "0x0",
            output: encodeFunctionResult({
              abi: factoryABI,
              functionName: "createPair",
              result: logs[3].address,
            }),
          },
          subtraces: 0,
          traceAddress: [0],
          transactionHash: logs[2]!.transactionHash!,
          transactionPosition: hexToNumber(logs[2]!.transactionIndex!),
          type: "call",
        },
      ],
    },
    block3: {
      logs: [logs[3]],
      block: blocks[2]!,
      transactions: blocks[2]!.transactions,
      transactionReceipts: transactionReceipts.filter(
        (tr) => tr?.blockNumber === blocks[2]?.number,
      ),
      traces: [
        {
          action: {
            callType: "call",
            from: ALICE,
            gas: "0x0",
            input: encodeFunctionData({
              abi: pairABI,
              functionName: "swap",
              args: [1n, 2n, ALICE],
            }),
            to: logs[3]!.address,
            value: "0x0",
          },
          blockHash: blocks[2]!.hash,
          blockNumber: blocks[2]!.number,
          result: {
            gasUsed: "0x0",
            output: encodeFunctionResult({
              abi: pairABI,
              functionName: "swap",
            }),
          },
          subtraces: 0,
          traceAddress: [0],
          transactionHash: logs[3]!.transactionHash!,
          transactionPosition: hexToNumber(logs[3]!.transactionIndex!),
          type: "call",
        },
      ],
    },
  } as unknown as {
    block1: {
      logs: [RpcLog, RpcLog];
      block: RpcBlock<Exclude<BlockTag, "pending">, true>;
      transactions: [RpcTransaction, RpcTransaction];
      transactionReceipts: [RpcTransactionReceipt, RpcTransactionReceipt];
      traces: [SyncTrace, SyncTrace];
    };
    block2: {
      logs: [RpcLog];
      block: RpcBlock<Exclude<BlockTag, "pending">, true>;
      transactions: [RpcTransaction];
      transactionReceipts: [RpcTransactionReceipt];
      traces: [SyncTrace];
    };
    block3: {
      logs: [RpcLog];
      block: RpcBlock<Exclude<BlockTag, "pending">, true>;
      transactions: [RpcTransaction];
      transactionReceipts: [RpcTransactionReceipt];
      traces: [SyncTrace];
    };
  };
};

/**
 * Mock function for `getLogEvents` that specifically returns the event data for the erc20 source.
 */
export const getEventsErc20 = async (
  sources: EventSource[],
): Promise<RawEvent[]> => {
  const rpcData = await getRawRPCData(sources);

  return [
    {
      log: rpcData.block1.logs[0],
      block: rpcData.block1.block,
      transaction: rpcData.block1.transactions[0]!,
      transactionReceipt: rpcData.block1.transactionReceipts[0]!,
    },
    {
      log: rpcData.block1.logs[1],
      block: rpcData.block1.block,
      transaction: rpcData.block1.transactions[1]!,
      transactionReceipt: rpcData.block1.transactionReceipts[1]!,
    },
  ]
    .map((e) => ({
      log: formatLog(e.log),
      block: formatBlock(e.block),
      transaction: formatTransaction(e.transaction),
      transactionReceipt: formatTransactionReceipt(e.transactionReceipt),
    }))
    .map(({ log, block, transaction, transactionReceipt }) => ({
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
        to: transaction.to ? checksumAddress(transaction.to) : transaction.to,
      },
      transactionReceipt: {
        ...transactionReceipt,
        from: checksumAddress(transactionReceipt.from),
        to: transactionReceipt.to
          ? checksumAddress(transactionReceipt.to)
          : transactionReceipt.to,
        logs: transactionReceipt.logs.map((l) => ({
          ...l,
          id: `${l.blockHash}-${toHex(l.logIndex!)}`,
        })),
      },
      encodedCheckpoint: encodeCheckpoint({
        blockTimestamp: Number(block.timestamp),
        chainId: BigInt(sources[0].chainId),
        blockNumber: block.number!,
        transactionIndex: BigInt(transaction.transactionIndex!),
        eventType: 5,
        eventIndex: BigInt(log.logIndex!),
      }),
    })) as RawEvent[];
};

export function getFreePort(): Promise<number> {
  return new Promise((res) => {
    const srv = createServer();
    srv.listen(0, () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close(() => res(port));
    });
  });
}

export async function waitForHealthy(port: number) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      clearInterval(interval);
      reject(new Error("Timed out while waiting for app to become healthy."));
    }, 5_000);
    const interval = setInterval(async () => {
      const response = await fetch(`http://localhost:${port}/health`);
      if (response.status === 200) {
        clearTimeout(timeout);
        clearInterval(interval);
        resolve(undefined);
      }
    }, 20);
  });
}

export async function postGraphql(port: number, query: string) {
  const response = await fetch(`http://localhost:${port}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: `query { ${query} }` }),
  });
  return response;
}

export async function getMetrics(port: number) {
  const response = await fetch(`http://localhost:${port}/metrics`);
  return await response.text();
}
