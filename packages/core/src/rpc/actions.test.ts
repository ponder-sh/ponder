import { type Address, type Hex, hexToNumber, numberToHex } from "viem";
import { expect, test, vi } from "vitest";
import type { SyncBlock, SyncTransaction } from "@/internal/types.js";
import type { RequestParameters, Rpc } from "@/rpc/index.js";
import { zeroLogsBloom } from "@/sync-realtime/bloom.js";
import { isAsyncExecutionChain } from "@/utils/finality.js";
import { drainAsyncGenerator } from "@/utils/generators.js";
import {
  debug_traceBlockByNumber,
  eth_getLogs,
  eth_getLogsWithPagination,
  eth_getTransactionReceipts,
  standardizeTransactions,
  validateLogsAndBlock,
} from "./actions.js";

test("debug trace actions rebuild traceAddress from the call tree", async () => {
  const frame = (overrides: Record<string, unknown> = {}) => ({
    type: "CALL",
    from: address,
    to: address,
    gas: "0x1",
    gasUsed: "0x1",
    input: "0x",
    ...overrides,
  });
  const rpc = {
    request: vi.fn(async () => [
      {
        txHash: hash,
        result: frame({ calls: [frame(), frame({ calls: [frame()] })] }),
      },
    ]),
  } as unknown as Rpc;

  await expect(
    debug_traceBlockByNumber(rpc, ["0x1", { tracer: "callTracer" }]),
  ).resolves.toMatchObject([
    { trace: { traceAddress: [] } },
    { trace: { traceAddress: [0] } },
    { trace: { traceAddress: [1] } },
    { trace: { traceAddress: [1, 0] } },
  ]);
});

test("debug trace actions exclude reverted traces and their children", async () => {
  const frame = (overrides: Record<string, unknown> = {}) => ({
    type: "CALL",
    from: address,
    to: address,
    gas: "0x1",
    gasUsed: "0x1",
    input: "0x",
    ...overrides,
  });
  const rpc = {
    request: vi.fn(async () => [
      {
        txHash: hash,
        result: frame({
          calls: [
            frame({ error: "execution reverted", calls: [frame()] }),
            frame({
              calls: [
                frame({ error: "out of gas", revertReason: "reason" }),
                frame(),
              ],
            }),
          ],
        }),
      },
      {
        txHash: hash,
        result: frame({ error: "execution reverted", calls: [frame()] }),
      },
    ]),
  } as unknown as Rpc;

  const traces = await debug_traceBlockByNumber(rpc, [
    "0x1",
    { tracer: "callTracer" },
  ]);

  expect(traces.map((trace) => trace.trace.traceAddress)).toStrictEqual([
    [],
    [1],
    [1, 1],
  ]);
});

const hash =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const address = "0x2222222222222222222222222222222222222222" as const;

const log = {
  blockNumber: "0x1",
  logIndex: "0x0",
  blockHash: hash,
  address,
  topics: [],
  data: "0x",
  transactionHash: hash,
  transactionIndex: "0x0",
};

test("eth_getLogs chunks address arrays and merges responses in order", async () => {
  const addresses = Array.from(
    { length: 51 },
    (_, index) => `0x${index.toString(16).padStart(40, "0")}` as Address,
  );
  const firstLog = { ...log, address: addresses[0], blockNumber: "0x2" };
  const secondLog = { ...log, address: addresses[50], logIndex: "0x1" };
  const requests: Extract<RequestParameters, { method: "eth_getLogs" }>[] = [];
  const rpcRequest = vi.fn(
    async (request: Extract<RequestParameters, { method: "eth_getLogs" }>) => {
      requests.push(request);
      const requestAddress = request.params[0].address;
      if (
        Array.isArray(requestAddress) &&
        requestAddress[0] === addresses[50]
      ) {
        return [secondLog];
      }
      return [firstLog];
    },
  );
  const rpc = { request: rpcRequest } as unknown as Rpc;
  const params: Extract<
    RequestParameters,
    { method: "eth_getLogs" }
  >["params"] = [{ address: addresses }];

  // Note: The second chunk has the earlier log.
  await expect(eth_getLogs(rpc, params)).resolves.toStrictEqual([
    secondLog,
    firstLog,
  ]);
  expect(requests).toHaveLength(2);
  expect(requests.map((request) => request.params[0].address)).toStrictEqual([
    addresses.slice(0, 50),
    [addresses[50]],
  ]);
  expect(params[0].address).toStrictEqual(addresses);
});

test("eth_getLogs sorts logs by block number and log index", async () => {
  const logs = [
    { ...log, blockNumber: "0x2", logIndex: "0x0" },
    { ...log, blockNumber: "0x1", logIndex: "0x1" },
    { ...log, blockNumber: "0x1", logIndex: "0x0" },
  ];
  const rpc = { request: vi.fn(async () => logs) } as unknown as Rpc;

  const result = await eth_getLogs(rpc, [{ fromBlock: "0x1", toBlock: "0x2" }]);
  expect(
    result.map(({ blockNumber, logIndex }) => [blockNumber, logIndex]),
  ).toStrictEqual([
    ["0x1", "0x0"],
    ["0x1", "0x1"],
    ["0x2", "0x0"],
  ]);
});

test("standardizeTransactions() sorts transactions by transaction index", () => {
  const transaction = {
    blockHash: hash,
    blockNumber: "0x1",
    from: address,
    hash,
    to: address,
    transactionIndex: "0x0",
  };
  const transactions = standardizeTransactions(
    [
      { ...transaction, transactionIndex: "0x2" },
      { ...transaction, transactionIndex: "0x0" },
      { ...transaction, transactionIndex: "0x1" },
    ] as unknown as SyncTransaction[],
    { method: "eth_getBlockByNumber", params: ["0x1", true] },
  );
  expect(
    transactions.map(({ transactionIndex }) => transactionIndex),
  ).toStrictEqual(["0x0", "0x1", "0x2"]);
});

test("eth_getLogs skips empty address arrays", async () => {
  const rpcRequest = vi.fn();
  const rpc = { request: rpcRequest } as unknown as Rpc;
  const params: Extract<
    RequestParameters,
    { method: "eth_getLogs" }
  >["params"] = [{ address: [] }];

  await expect(eth_getLogs(rpc, params)).resolves.toStrictEqual([]);
  expect(rpcRequest).not.toHaveBeenCalled();
});

test("eth_getLogsWithPagination yields pages lazily and grows the range", async () => {
  const request = vi.fn(
    async (
      request: Extract<RequestParameters, { method: "eth_getLogs" }>,
      _context?: Parameters<Rpc["request"]>[1],
    ) => [{ ...log, blockNumber: request.params[0].fromBlock as Hex }],
  );
  const rpc = { request } as unknown as Rpc;
  const params = [
    { address, topics: [hash], fromBlock: "0x0", toBlock: numberToHex(1100) },
  ] satisfies Parameters<typeof eth_getLogsWithPagination>[1];
  const context = { retryNullBlockRequest: false };
  const generator = eth_getLogsWithPagination(rpc, params, context);

  expect(request).not.toHaveBeenCalled();
  expect(await generator.next()).toMatchObject({
    done: false,
    value: {
      logs: [{ blockNumber: "0x0", removed: false }],
      fromBlock: 0,
      toBlock: 499,
    },
  });
  expect(
    request.mock.calls.map(([request]) => [
      hexToNumber(request.params[0].fromBlock as Hex),
      hexToNumber(request.params[0].toBlock as Hex),
    ]),
  ).toStrictEqual([[0, 499]]);

  const pages = await drainAsyncGenerator(generator);
  expect(
    pages.map(({ fromBlock, toBlock }) => [fromBlock, toBlock]),
  ).toStrictEqual([
    [500, 1024],
    [1025, 1100],
  ]);
  expect(pages.map((page) => page.logs[0]!.blockNumber)).toStrictEqual([
    numberToHex(500),
    numberToHex(1025),
  ]);
  expect(
    request.mock.calls.map(([request]) => [
      hexToNumber(request.params[0].fromBlock as Hex),
      hexToNumber(request.params[0].toBlock as Hex),
    ]),
  ).toStrictEqual([
    [0, 499],
    [500, 1024],
    [1025, 1100],
  ]);
  for (const [rpcRequest, requestContext] of request.mock.calls) {
    expect(rpcRequest.params[0]).toMatchObject({ address, topics: [hash] });
    expect(requestContext).toBe(context);
  }
  expect(params[0].fromBlock).toBe("0x0");
});

test("eth_getLogsWithPagination stops fetching when the consumer stops", async () => {
  const request = vi.fn().mockResolvedValue([]);
  const rpc = { request } as unknown as Rpc;
  for await (const _logs of eth_getLogsWithPagination(rpc, [
    { fromBlock: "0x0", toBlock: "0xffff" },
  ])) {
    break;
  }
  expect(request).toHaveBeenCalledTimes(1);
});

test("eth_getLogsWithPagination retries suggested ranges and keeps the limit per RPC", async () => {
  const request = vi.fn(
    async (
      request: Extract<RequestParameters, { method: "eth_getLogs" }>,
      _context?: Parameters<Rpc["request"]>[1],
    ) => [{ ...log, blockNumber: request.params[0].fromBlock as Hex }],
  );
  const rpc = { request } as unknown as Rpc;
  request.mockRejectedValueOnce({ message: "Max range: 20" });

  await drainAsyncGenerator(
    eth_getLogsWithPagination(rpc, [
      { fromBlock: "0x0", toBlock: numberToHex(44) },
    ]),
  );
  expect(
    request.mock.calls.map(([request]) => [
      hexToNumber(request.params[0].fromBlock as Hex),
      hexToNumber(request.params[0].toBlock as Hex),
    ]),
  ).toStrictEqual([
    [0, 44],
    [0, 19],
    [20, 39],
    [40, 44],
  ]);

  const otherRequest = vi.fn(
    async (
      _request: Extract<RequestParameters, { method: "eth_getLogs" }>,
    ) => [],
  );
  const otherRpc = { request: otherRequest } as unknown as Rpc;
  await drainAsyncGenerator(
    eth_getLogsWithPagination(otherRpc, [
      { fromBlock: numberToHex(45), toBlock: numberToHex(89) },
    ]),
  );
  expect(
    otherRequest.mock.calls.map(([request]) => [
      hexToNumber(request.params[0].fromBlock as Hex),
      hexToNumber(request.params[0].toBlock as Hex),
    ]),
  ).toStrictEqual([[45, 89]]);

  request.mockClear();
  await drainAsyncGenerator(
    eth_getLogsWithPagination(rpc, [
      { fromBlock: numberToHex(45), toBlock: numberToHex(89) },
    ]),
  );
  expect(
    request.mock.calls.map(([request]) => [
      hexToNumber(request.params[0].fromBlock as Hex),
      hexToNumber(request.params[0].toBlock as Hex),
    ]),
  ).toStrictEqual([
    [45, 64],
    [65, 84],
    [85, 89],
  ]);
});

const receipt = {
  blockHash: hash,
  blockNumber: "0x1",
  contractAddress: null,
  cumulativeGasUsed: "0x1",
  effectiveGasPrice: "0x1",
  from: address,
  gasUsed: "0x1",
  logs: [],
  logsBloom: zeroLogsBloom,
  status: "0x1",
  to: address,
  transactionHash: hash,
  transactionIndex: "0x0",
  type: "0x0",
};

test("eth_getTransactionReceipts falls back to eth_getTransactionReceipt per RPC", async () => {
  const request = vi.fn(async (request: RequestParameters) => {
    if (request.method === "eth_getBlockReceipts") {
      throw new Error("method not supported");
    }
    return receipt;
  });
  const rpc = { request } as unknown as Rpc;
  const params = { blockHash: hash, transactionHashes: new Set([hash]) };

  await expect(eth_getTransactionReceipts(rpc, params)).resolves.toMatchObject([
    { request: { method: "eth_getTransactionReceipt", params: [hash] } },
  ]);
  await eth_getTransactionReceipts(rpc, params);
  expect(request.mock.calls.map(([request]) => request.method)).toStrictEqual([
    "eth_getBlockReceipts",
    "eth_getTransactionReceipt",
    "eth_getTransactionReceipt",
  ]);

  const otherRequest = vi.fn(async () => [receipt]);
  const otherRpc = { request: otherRequest } as unknown as Rpc;
  await expect(
    eth_getTransactionReceipts(otherRpc, params),
  ).resolves.toMatchObject([
    { request: { method: "eth_getBlockReceipts", params: [hash] } },
  ]);
  expect(otherRequest).toHaveBeenCalledTimes(1);
});

test("eth_getTransactionReceipts sorts receipts by transaction index", async () => {
  const otherHash =
    "0x3333333333333333333333333333333333333333333333333333333333333333" as const;
  const receipts = [
    { ...receipt, transactionHash: otherHash, transactionIndex: "0x1" },
    { ...receipt, transactionHash: hash, transactionIndex: "0x0" },
  ];
  const params = {
    blockHash: hash,
    transactionHashes: new Set([otherHash, hash]),
  };

  const request = vi.fn(async () =>
    receipts.map((receipt) => ({ ...receipt })),
  );
  const rpc = { request } as unknown as Rpc;
  const [response] = await eth_getTransactionReceipts(rpc, params);
  expect(
    response!.receipts.map(({ transactionIndex }) => transactionIndex),
  ).toStrictEqual(["0x0", "0x1"]);

  const fallbackRequest = vi.fn(async (request: RequestParameters) => {
    if (request.method === "eth_getBlockReceipts") {
      throw new Error("method not supported");
    }
    return receipts.find(
      (receipt) =>
        receipt.transactionHash ===
        (
          request as Extract<
            RequestParameters,
            { method: "eth_getTransactionReceipt" }
          >
        ).params[0],
    );
  });
  const fallbackRpc = { request: fallbackRequest } as unknown as Rpc;
  const responses = await eth_getTransactionReceipts(fallbackRpc, params);
  expect(
    responses.flatMap(({ receipts }) =>
      receipts.map(({ transactionIndex }) => transactionIndex),
    ),
  ).toStrictEqual(["0x0", "0x1"]);
});

test("eth_getLogsWithPagination retries unfinished blocks and grows inferred ranges", async () => {
  const request = vi.fn(
    async (
      request: Extract<RequestParameters, { method: "eth_getLogs" }>,
      _context?: Parameters<Rpc["request"]>[1],
    ) => [{ ...log, blockNumber: request.params[0].fromBlock as Hex }],
  );
  const rpc = { request } as unknown as Rpc;
  request.mockResolvedValueOnce([]);
  request.mockRejectedValueOnce({ message: "query exceeds max results" });

  const pages = await drainAsyncGenerator(
    eth_getLogsWithPagination(rpc, [
      { fromBlock: "0x0", toBlock: numberToHex(1200) },
    ]),
  );
  expect(pages[0]!.logs).toStrictEqual([]);
  expect(pages.slice(1).map((page) => page.logs[0]!.blockNumber)).toStrictEqual(
    [numberToHex(500), numberToHex(763), numberToHex(1039)],
  );
  expect(
    request.mock.calls.map(([request]) => [
      hexToNumber(request.params[0].fromBlock as Hex),
      hexToNumber(request.params[0].toBlock as Hex),
    ]),
  ).toStrictEqual([
    [0, 499],
    [500, 1024],
    [500, 762],
    [763, 1038],
    [1039, 1200],
  ]);
});

test("eth_getLogsWithPagination propagates errors when retries are exhausted", async () => {
  const request = vi.fn(
    async (
      request: Extract<RequestParameters, { method: "eth_getLogs" }>,
      _context?: Parameters<Rpc["request"]>[1],
    ) => [{ ...log, blockNumber: request.params[0].fromBlock as Hex }],
  );
  const rpc = { request } as unknown as Rpc;
  const error = { message: "query exceeds max results" };
  request.mockRejectedValue(error);

  await expect(
    drainAsyncGenerator(
      eth_getLogsWithPagination(rpc, [{ fromBlock: "0x0", toBlock: "0x1" }]),
    ),
  ).rejects.toBe(error);
  expect(
    request.mock.calls.map(([request]) => [
      hexToNumber(request.params[0].fromBlock as Hex),
      hexToNumber(request.params[0].toBlock as Hex),
    ]),
  ).toStrictEqual([
    [0, 1],
    [0, 0],
  ]);
});

test("eth_getLogsWithPagination uses fixed ranges and disables range retries", async () => {
  const request = vi.fn(
    async (
      request: Extract<RequestParameters, { method: "eth_getLogs" }>,
      _context?: Parameters<Rpc["request"]>[1],
    ) => [{ ...log, blockNumber: request.params[0].fromBlock as Hex }],
  );
  const rpc = { request } as unknown as Rpc;
  const context = { ethGetLogsBlockRange: 2 };
  await drainAsyncGenerator(
    eth_getLogsWithPagination(
      rpc,
      [{ fromBlock: "0x0", toBlock: "0x4" }],
      context,
    ),
  );
  expect(
    request.mock.calls.map(([request]) => [
      hexToNumber(request.params[0].fromBlock as Hex),
      hexToNumber(request.params[0].toBlock as Hex),
    ]),
  ).toStrictEqual([
    [0, 1],
    [2, 3],
    [4, 4],
  ]);

  request.mockClear();
  const error = { message: "Max range: 1" };
  request.mockRejectedValueOnce(error);
  await expect(
    drainAsyncGenerator(
      eth_getLogsWithPagination(
        rpc,
        [{ fromBlock: "0x0", toBlock: "0x4" }],
        context,
      ),
    ),
  ).rejects.toBe(error);
  expect(request).toHaveBeenCalledTimes(1);
});

const nonEmptyLogsBloom = `0x${"0".repeat(511)}1` as const;
const logsRequest = {
  method: "eth_getLogs",
  params: [{ blockHash: hash }],
} as const satisfies Extract<RequestParameters, { method: "eth_getLogs" }>;
const blockRequest = {
  method: "eth_getBlockByHash",
  params: [hash, true],
} as const satisfies Extract<
  RequestParameters,
  { method: "eth_getBlockByHash" }
>;

const createBlock = (block: { logsBloom: Hex }) =>
  ({
    hash,
    number: "0x1",
    transactions: [],
    ...block,
  }) as unknown as SyncBlock;

test("validateLogsAndBlock throws for non-empty logsBloom with no logs", () => {
  expect(() =>
    validateLogsAndBlock(
      [],
      createBlock({ logsBloom: nonEmptyLogsBloom }),
      logsRequest,
      blockRequest,
      isAsyncExecutionChain(1),
    ),
  ).toThrow("The logs array has length 0");
});

test("validateLogsAndBlock allows zero logsBloom with no logs", () => {
  expect(() =>
    validateLogsAndBlock(
      [],
      createBlock({ logsBloom: zeroLogsBloom }),
      logsRequest,
      blockRequest,
      isAsyncExecutionChain(1),
    ),
  ).not.toThrow();
});

test.each([143, 10143, 43114, 43113])(
  "validateLogsAndBlock allows non-empty bloom with no logs on chain %i",
  (chainId) => {
    expect(() =>
      validateLogsAndBlock(
        [],
        createBlock({ logsBloom: nonEmptyLogsBloom }),
        logsRequest,
        blockRequest,
        isAsyncExecutionChain(chainId),
      ),
    ).not.toThrow();
  },
);

test.each([143, 10143, 43114, 43113])(
  "validateLogsAndBlock still rejects mismatched block hashes on chain %i",
  (chainId) => {
    expect(() =>
      validateLogsAndBlock(
        [
          {
            address: `0x${"1".repeat(40)}`,
            blockHash: `0x${"2".repeat(64)}`,
            blockNumber: "0x1",
            logIndex: "0x0",
            data: "0x",
            topics: [],
            transactionHash: hash,
            transactionIndex: "0x0",
            removed: false,
          },
        ],
        createBlock({ logsBloom: nonEmptyLogsBloom }),
        logsRequest,
        blockRequest,
        isAsyncExecutionChain(chainId),
      ),
    ).toThrow("has a 'log.blockHash'");
  },
);
