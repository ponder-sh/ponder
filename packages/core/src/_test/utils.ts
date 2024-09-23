import { type AddressInfo, createServer } from "node:net";
import { buildConfigAndIndexingFunctions } from "@/build/configAndIndexingFunctions.js";
import type { Common } from "@/common/common.js";
import { createConfig } from "@/config/config.js";
import type { RawEvent } from "@/sync/events.js";
import type { Status } from "@/sync/index.js";
import type { Source } from "@/sync/source.js";
import type {
  SyncBlock,
  SyncCallTrace,
  SyncCreateTrace,
  SyncLog,
  SyncTransaction,
  SyncTransactionReceipt,
} from "@/types/sync.js";
import {
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { createRequestQueue } from "@/utils/requestQueue.js";
import {
  type Chain,
  type Hash,
  type Hex,
  encodeFunctionData,
  encodeFunctionResult,
  formatTransactionReceipt,
  hexToBigInt,
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
        includeCallTraces: true,
        filter: {
          event: ["Swap"],
        },
      },
      Factory: {
        abi: factoryABI,
        network: "mainnet",
        address: addresses.factoryAddress,
        includeCallTraces: true,
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
  const { networks, sources } = await buildConfigAndIndexingFunctions({
    config,
    rawIndexingFunctions: [
      {
        name: "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)",
        fn: () => {},
      },
      { name: "Pair:Swap", fn: () => {} },
      { name: "Pair.swap()", fn: () => {} },
      { name: "OddBlocks:block", fn: () => {} },
      { name: "Factory.createPair()", fn: () => {} },
    ],
    options: common.options,
  });
  const mainnet = { ...networks[0], finalityBlockCount: 4 };

  const requestQueue = createRequestQueue({
    network: networks[0]!,
    common,
  });

  return {
    networks: [mainnet],
    sources,
    requestQueues: [requestQueue],
  };
};

/**
 * Returns the logs, block, traces, and transaction data for blocks 1, 2, 3, 4, 5.
 * Block 2 has two contract creations.
 * Block 2 has two erc20 transfer events.
 * Block 3 has a pair creation event.
 * Block 4 has a swap event from the newly created pair.
 * Block 5 is empty.
 */
export const getRawRPCData = async () => {
  const latestBlock = await publicClient.getBlockNumber();
  const logs = await publicClient.request({
    method: "eth_getLogs",
    params: [
      {
        fromBlock: toHex(latestBlock - 3n),
      },
    ],
  });

  // Manually add the child address log
  logs.push(
    ...(await publicClient.request({
      method: "eth_getLogs",
      params: [
        {
          address: slice(logs[2]!.topics[1]!, 12),
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
    [1, 2, 3, 4, 5].map(
      (bn) =>
        publicClient.request({
          method: "eth_getBlockByNumber",
          params: [toHex(bn), true],
        }) as Promise<SyncBlock>,
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
      logs: [],
      block: blocks[0],
      transactions: [],
      transactionReceipts: [],
      callTraces: [
        {
          action: {
            from: ALICE,
            gas: "0x0",
            init: "0x0",
            value: "0x0",
          },
          blockHash: blocks[0]!.hash,
          blockNumber: blocks[0]!.number,
          result: {
            address: "0x0",
            code: "0x0",
            gasUsed: "0x0",
          },
          subtraces: 0,
          traceAddress: [0],
          transactionHash: blocks[0]!.transactions[0]!.hash,
          transactionPosition: hexToNumber(
            blocks[0]!.transactions[0]!.transactionIndex,
          ),
          type: "create",
        },
        {
          action: {
            from: ALICE,
            gas: "0x0",
            init: "0x0",
            value: "0x0",
          },
          blockHash: blocks[0]!.hash,
          blockNumber: blocks[0]!.number,
          result: {
            address: "0x0",
            code: "0x0",
            gasUsed: "0x0",
          },
          subtraces: 0,
          traceAddress: [0],
          transactionHash: blocks[0]!.transactions[1]!.hash,
          transactionPosition: hexToNumber(
            blocks[0]!.transactions[1]!.transactionIndex,
          ),
          type: "create",
        },
      ],
    },
    block2: {
      logs: [logs[0]!, logs[1]!],
      block: blocks[1]!,
      transactions: blocks[1]!.transactions,
      transactionReceipts: transactionReceipts.filter(
        (tr) => tr?.blockNumber === blocks[1]?.number,
      ),
      callTraces: [
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
          blockHash: blocks[1]!.hash,
          blockNumber: blocks[1]!.number,
          result: {
            gasUsed: "0x0",
            output: encodeFunctionResult({
              abi: erc20ABI,
              functionName: "mint",
            }),
          },
          subtraces: 0,
          traceAddress: [0],
          transactionHash: blocks[1]!.transactions[0]!.hash,
          transactionPosition: hexToNumber(
            blocks[1]!.transactions[0]!.transactionIndex,
          ),
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
          blockHash: blocks[1]!.hash,
          blockNumber: blocks[1]!.number,
          result: {
            gasUsed: "0x0",
            output: encodeFunctionResult({
              abi: erc20ABI,
              functionName: "mint",
            }),
          },
          subtraces: 0,
          traceAddress: [0],
          transactionHash: blocks[1]!.transactions[1]!.hash,
          transactionPosition: hexToNumber(
            blocks[1]!.transactions[1]!.transactionIndex,
          ),
          type: "call",
        },
      ],
    },
    block3: {
      logs: [logs[2]],
      block: blocks[2],
      transactions: blocks[2]!.transactions,
      transactionReceipts: transactionReceipts.filter(
        (tr) => tr?.blockNumber === blocks[2]?.number,
      ),
      callTraces: [
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
          blockHash: blocks[2]!.hash,
          blockNumber: blocks[2]!.number,
          result: {
            gasUsed: "0x0",
            output: encodeFunctionResult({
              abi: factoryABI,
              functionName: "createPair",
              result: logs[3]!.address,
            }),
          },
          subtraces: 0,
          traceAddress: [0],
          transactionHash: blocks[2]!.transactions[0]!.hash,
          transactionPosition: hexToNumber(
            blocks[2]!.transactions[0]!.transactionIndex,
          ),
          type: "call",
        },
      ],
    },
    block4: {
      logs: [logs[3]],
      block: blocks[3],
      transactions: blocks[3]!.transactions,
      transactionReceipts: transactionReceipts.filter(
        (tr) => tr?.blockNumber === blocks[3]?.number,
      ),
      callTraces: [
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
          blockHash: blocks[3]!.hash,
          blockNumber: blocks[3]!.number,
          result: {
            gasUsed: "0x0",
            output: encodeFunctionResult({
              abi: pairABI,
              functionName: "swap",
            }),
          },
          subtraces: 0,
          traceAddress: [0],
          transactionHash: blocks[3]!.transactions[0]!.hash,
          transactionPosition: hexToNumber(
            blocks[3]!.transactions[0]!.transactionIndex,
          ),
          type: "call",
        },
      ],
    },
    block5: {
      logs: [],
      block: blocks[4]!,
      transactions: [],
      transactionReceipts: [],
      callTraces: [],
    },
  } as unknown as {
    block1: {
      logs: [];
      block: SyncBlock;
      transactions: [];
      transactionReceipts: [];
      callTraces: [SyncCreateTrace, SyncCreateTrace];
    };
    block2: {
      logs: [SyncLog, SyncLog];
      block: SyncBlock;
      transactions: [SyncTransaction, SyncTransaction];
      transactionReceipts: [SyncTransactionReceipt, SyncTransactionReceipt];
      callTraces: [SyncCallTrace, SyncCallTrace];
    };
    block3: {
      logs: [SyncLog];
      block: SyncBlock;
      transactions: [SyncTransaction];
      transactionReceipts: [SyncTransactionReceipt];
      callTraces: [SyncCallTrace];
    };
    block4: {
      logs: [SyncLog];
      block: SyncBlock;
      transactions: [SyncTransaction];
      transactionReceipts: [SyncTransactionReceipt];
      callTraces: [SyncCallTrace];
    };
    block5: {
      logs: [];
      block: SyncBlock;
      transactions: [];
      transactionReceipts: [];
      callTraces: [];
    };
  };
};

/**
 * Mock function for `getEvents` that specifically returns the event data for the log and factory sources.
 */
export const getEventsLog = async (sources: Source[]): Promise<RawEvent[]> => {
  const rpcData = await getRawRPCData();

  return [
    {
      log: rpcData.block2.logs[0],
      block: rpcData.block2.block,
      transaction: rpcData.block2.transactions[0]!,
      transactionReceipt: rpcData.block2.transactionReceipts[0]!,
    },
    {
      log: rpcData.block2.logs[1],
      block: rpcData.block2.block,
      transaction: rpcData.block2.transactions[1]!,
      transactionReceipt: rpcData.block2.transactionReceipts[1]!,
    },
    {
      log: rpcData.block4.logs[0],
      block: rpcData.block4.block,
      transaction: rpcData.block4.transactions[0]!,
      transactionReceipt: rpcData.block4.transactionReceipts[0]!,
    },
  ]
    .map((e) => ({
      log: formatLog(e.log),
      block: formatBlock(e.block),
      transaction: formatTransaction(e.transaction),
      transactionReceipt: formatTransactionReceipt(e.transactionReceipt),
    }))
    .map(({ log, block, transaction, transactionReceipt }, i) => ({
      sourceIndex: i === 0 || i === 1 ? 0 : 1,
      chainId: sources[0]!.filter.chainId,
      checkpoint: encodeCheckpoint({
        blockTimestamp: Number(block.timestamp),
        chainId: BigInt(sources[0]!.filter.chainId),
        blockNumber: block.number!,
        transactionIndex: BigInt(transaction.transactionIndex!),
        eventType: 5,
        eventIndex: BigInt(log.logIndex!),
      }),
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
    })) as RawEvent[];
};

/**
 * Mock function for `getEvents` that specifically returns the event data for the block sources.
 */
export const getEventsBlock = async (
  sources: Source[],
): Promise<RawEvent[]> => {
  const rpcData = await getRawRPCData();

  return [
    {
      block: rpcData.block3.block,
    },
  ]
    .map((e) => ({
      block: formatBlock(e.block),
    }))
    .map(({ block }) => ({
      sourceIndex: 4,
      chainId: sources[4]!.filter.chainId,
      checkpoint: encodeCheckpoint({
        blockTimestamp: Number(block.timestamp),
        chainId: BigInt(sources[0]!.filter.chainId),
        blockNumber: block.number!,
        transactionIndex: maxCheckpoint.transactionIndex,
        eventType: 5,
        eventIndex: zeroCheckpoint.eventIndex,
      }),

      block: { ...block, miner: checksumAddress(block.miner) },
    })) as RawEvent[];
};

/**
 * Mock function for `getEvents` that specifically returns the event data for the trace sources.
 */
export const getEventsTrace = async (
  sources: Source[],
): Promise<RawEvent[]> => {
  const rpcData = await getRawRPCData();

  return [
    {
      trace: rpcData.block3.callTraces[0],
      block: rpcData.block3.block,
      transaction: rpcData.block3.transactions[0]!,
      transactionReceipt: rpcData.block3.transactionReceipts[0]!,
    },
  ]
    .map((e) => ({
      trace: e.trace,
      block: formatBlock(e.block),
      transaction: formatTransaction(e.transaction),
      transactionReceipt: formatTransactionReceipt(e.transactionReceipt),
    }))
    .map(({ trace, block, transaction, transactionReceipt }) => ({
      sourceIndex: 3,
      chainId: sources[3]!.filter.chainId,
      checkpoint: encodeCheckpoint({
        blockTimestamp: Number(block.timestamp),
        chainId: BigInt(sources[0]!.filter.chainId),
        blockNumber: block.number!,
        transactionIndex: BigInt(transaction.transactionIndex!),
        eventType: 7,
        eventIndex: 0n,
      }),
      trace: {
        id: `${trace.transactionHash}-${JSON.stringify(trace.traceAddress)}`,
        from: checksumAddress(trace.action.from),
        to: checksumAddress(trace.action.to),
        gas: hexToBigInt(trace.action.gas),
        value: hexToBigInt(trace.action.value),
        input: trace.action.input,
        output: trace.result!.output,
        gasUsed: hexToBigInt(trace.result!.gasUsed),
        subtraces: trace.subtraces,
        traceAddress: trace.traceAddress,
        blockHash: trace.blockHash,
        blockNumber: hexToBigInt(trace.blockNumber),
        transactionHash: trace.transactionHash,
        transactionIndex: trace.transactionPosition,
        callType: trace.action.callType,
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

export async function waitForIndexedBlock(
  port: number,
  networkName: string,
  blockNumber: number,
) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      clearInterval(interval);
      reject(new Error("Timed out while waiting for the indexed block."));
    }, 5_000);
    const interval = setInterval(async () => {
      const response = await fetch(`http://localhost:${port}/status`);
      if (response.status === 200) {
        const status = (await response.json()) as Status | null;
        const statusBlockNumber = status
          ? status[networkName]?.block?.number
          : undefined;
        if (
          statusBlockNumber !== undefined &&
          statusBlockNumber >= blockNumber
        ) {
          clearTimeout(timeout);
          clearInterval(interval);
          resolve(undefined);
        }
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
