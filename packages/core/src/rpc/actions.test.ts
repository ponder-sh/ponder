import { type Address, type Hex, hexToNumber, numberToHex } from "viem";
import { beforeEach, expect, test, vi } from "vitest";
import type { RequestParameters, Rpc } from "@/rpc/index.js";
import { drainAsyncGenerator } from "@/utils/generators.js";
import { eth_getLogs } from "./actions.js";

let eth_getLogsWithPagination: typeof import("./actions.js").eth_getLogsWithPagination;

beforeEach(async () => {
  // Reload actions so each test starts with a fresh logsRequestMetadata estimate,
  // instead of inheriting provider limits learned by earlier tests.
  if ("bun" in process.versions) {
    // Bun does not implement vi.resetModules(); clearing require.cache also resets ESM.
    delete require.cache[require.resolve("./actions.js")];
  } else {
    vi.resetModules();
  }
  ({ eth_getLogsWithPagination } = await import("./actions.js"));
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

test("eth_getLogs chunks address arrays and merges responses", async () => {
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

  await expect(eth_getLogs(rpc, params)).resolves.toStrictEqual([
    firstLog,
    secondLog,
  ]);
  expect(requests).toHaveLength(2);
  expect(requests.map((request) => request.params[0].address)).toStrictEqual([
    addresses.slice(0, 50),
    [addresses[50]],
  ]);
  expect(params[0].address).toStrictEqual(addresses);
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
    value: [{ blockNumber: "0x0", removed: false }],
  });
  expect(
    request.mock.calls.map(([request]) => [
      hexToNumber(request.params[0].fromBlock as Hex),
      hexToNumber(request.params[0].toBlock as Hex),
    ]),
  ).toStrictEqual([[0, 499]]);

  const pages = await drainAsyncGenerator(generator);
  expect(pages.map((logs) => logs[0]!.blockNumber)).toStrictEqual([
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

test("eth_getLogsWithPagination retries suggested ranges and shares the limit across RPCs", async () => {
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
  ).toStrictEqual([
    [45, 64],
    [65, 84],
    [85, 89],
  ]);
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
  expect(pages[0]).toStrictEqual([]);
  expect(pages.slice(1).map((logs) => logs[0]!.blockNumber)).toStrictEqual([
    numberToHex(500),
    numberToHex(763),
    numberToHex(1039),
  ]);
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
