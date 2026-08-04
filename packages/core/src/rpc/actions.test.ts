import type { Address, Hex } from "viem";
import { expect, test, vi } from "vitest";
import type { RequestParameters, Rpc } from "@/rpc/index.js";
import {
  eth_getLogs,
  standardizeQueryBlocks,
  standardizeQueryLogs,
  standardizeQueryTraces,
  standardizeQueryTransactions,
  standardizeQueryTransfers,
} from "./actions.js";

const hash =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const address = "0x2222222222222222222222222222222222222222" as const;
const createLog = ({
  address: logAddress = address,
  blockNumber = "0x1",
  logIndex = "0x0",
}: {
  address?: Address;
  blockNumber?: Hex;
  logIndex?: Hex;
} = {}) => ({
  blockNumber,
  logIndex,
  blockHash: hash,
  address: logAddress,
  topics: [],
  data: "0x",
  transactionHash: hash,
  transactionIndex: "0x0",
});

test("eth_getLogs chunks address arrays and merges responses", async () => {
  const addresses = Array.from(
    { length: 51 },
    (_, index) => `0x${index.toString(16).padStart(40, "0")}` as Address,
  );
  const firstLog = createLog({
    address: addresses[0],
    blockNumber: "0x2",
  });
  const secondLog = createLog({
    address: addresses[50],
    blockNumber: "0x1",
    logIndex: "0x1",
  });
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

const envelope = {
  fromBlock: { number: "0x1", hash, parentHash: hash },
  toBlock: { number: "0x1", hash, parentHash: hash },
  cursorBlock: { number: "0x1", hash, parentHash: hash },
};

function request<method extends RequestParameters["method"]>(
  method: method,
  params: object = {},
) {
  return {
    method,
    params: [params],
  } as unknown as Extract<RequestParameters, { method: method }>;
}

test("standardizeQueryBlocks applies raw block defaults", () => {
  const response = {
    ...envelope,
    data: {
      blocks: [
        {
          hash,
          number: "0x1",
          timestamp: "0x2",
          logsBloom: "0x00",
          parentHash: hash,
        },
      ],
    },
  };

  const result = standardizeQueryBlocks(
    response as never,
    request("eth_queryBlocks"),
  );

  expect(result).toBe(response);
  expect(response.data.blocks[0]).toMatchObject({
    baseFeePerGas: "0x0",
    extraData: "0x",
    gasLimit: "0x0",
    gasUsed: "0x0",
    miner: "0x0000000000000000000000000000000000000000",
    nonce: "0x0",
  });
});

test("standardizeQueryTransactions preserves raw nullable and discriminator fields", () => {
  const response = {
    ...envelope,
    data: {
      transactions: [
        {
          hash,
          transactionHash: hash,
          transactionIndex: "0x0",
          blockNumber: "0x1",
          blockHash: hash,
          from: address,
          to: null,
          status: "0x1",
        },
      ],
    },
  };

  standardizeQueryTransactions(
    response as never,
    request("eth_queryTransactions"),
  );

  expect(response.data.transactions[0]).toMatchObject({
    input: "0x",
    type: "0x0",
    to: null,
    status: "0x1",
  });
  expect("typeHex" in response.data.transactions[0]!).toBe(false);
});

test("standardizeQueryTransactions validates requested block relations", () => {
  const block = {
    hash,
    number: "0x1",
    timestamp: "0x2",
    logsBloom: "0x",
    parentHash: hash,
  };
  const transaction = {
    hash,
    transactionHash: hash,
    transactionIndex: "0x0",
    blockNumber: "0x1",
    blockHash: hash,
    from: address,
    status: "0x1",
  };
  const params = { fields: { transactions: true, blocks: true } };

  expect(() =>
    standardizeQueryTransactions(
      {
        ...envelope,
        data: { blocks: [block], transactions: [transaction] },
      } as never,
      request("eth_queryTransactions", params),
    ),
  ).not.toThrow();

  expect(() =>
    standardizeQueryTransactions(
      {
        ...envelope,
        data: {
          blocks: [block],
          transactions: [{ ...transaction, blockNumber: "0x2" }],
        },
      } as never,
      request("eth_queryTransactions", params),
    ),
  ).toThrow("'transaction.blockNumber'");

  expect(() =>
    standardizeQueryTransactions(
      {
        ...envelope,
        data: { transactions: [transaction] },
      } as never,
      request("eth_queryTransactions", params),
    ),
  ).toThrow("'data.blocks' is a required property");
});

test("standardizeQueryLogs preserves nullable fields and defaults identity fields", () => {
  const response = {
    ...envelope,
    data: {
      logs: [
        {
          blockNumber: "0x1",
          logIndex: "0x0",
          blockHash: hash,
          address,
          topics: [],
          data: "0x",
          blockTimestamp: null,
        },
      ],
    },
  };

  standardizeQueryLogs(response as never, request("eth_queryLogs"));

  expect(response.data.logs[0]).toMatchObject({
    blockTimestamp: null,
    removed: false,
    transactionHash:
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    transactionIndex: "0x0",
  });
});

test("standardizeQueryTraces validates raw metadata and keeps raw status", () => {
  const response = {
    ...envelope,
    data: {
      traces: [
        {
          blockHash: hash,
          blockNumber: "0x1",
          transactionHash: hash,
          transactionIndex: "0x0",
          traceAddress: [],
          subcalls: "0x0",
          status: "0x1",
          type: "CALL",
          from: address,
          input: "0x",
        },
      ],
    },
  };

  standardizeQueryTraces(response as never, request("eth_queryTraces"));

  expect(response.data.traces[0]).toMatchObject({
    gas: "0x0",
    gasUsed: "0x0",
    status: "0x1",
  });
  expect(() =>
    standardizeQueryTraces(
      {
        ...response,
        data: {
          traces: [{ ...response.data.traces[0], blockHash: undefined }],
        },
      } as never,
      request("eth_queryTraces"),
    ),
  ).toThrow("'trace.blockHash' is a required property");
});

test("standardizeQueryTransfers validates raw metadata and numeric bounds", () => {
  const response = {
    ...envelope,
    data: {
      transfers: [
        {
          blockHash: hash,
          blockNumber: "0x1",
          transactionHash: hash,
          transactionIndex: "0x0",
          traceAddress: [0],
          from: address,
          to: null,
          value: "0x2",
          status: "0x0",
        },
      ],
    },
  };

  standardizeQueryTransfers(response as never, request("eth_queryTransfers"));
  expect(response.data.transfers[0]).toMatchObject({
    to: null,
    value: "0x2",
    status: "0x0",
  });

  expect(() =>
    standardizeQueryTransfers(
      {
        ...response,
        data: {
          transfers: [
            {
              ...response.data.transfers[0],
              transactionIndex: "0x10000000000000000",
            },
          ],
        },
      } as never,
      request("eth_queryTransfers"),
    ),
  ).toThrow("'transfer.transactionIndex'");
});

test("standardizeQueryLogs validates related block and transaction bounds", () => {
  const block = {
    hash,
    number: "0x1",
    timestamp: "0x1",
    logsBloom: "0x",
    parentHash: hash,
  };
  const transaction = {
    hash,
    transactionHash: hash,
    transactionIndex: "0x0",
    blockNumber: "0x1",
    blockHash: hash,
    from: address,
    status: "0x1",
  };

  expect(() =>
    standardizeQueryLogs(
      {
        ...envelope,
        data: {
          blocks: [{ ...block, number: "0x10000000000000000" }],
          transactions: [transaction],
          logs: [],
        },
      } as never,
      request("eth_queryLogs"),
    ),
  ).toThrow("'block.number'");

  expect(() =>
    standardizeQueryLogs(
      {
        ...envelope,
        data: {
          blocks: [block],
          transactions: [
            { ...transaction, transactionIndex: "0x10000000000000000" },
          ],
          logs: [],
        },
      } as never,
      request("eth_queryLogs"),
    ),
  ).toThrow("'transaction.transactionIndex'");
});

test("standardizeQueryTraces requires trace identity", () => {
  expect(() =>
    standardizeQueryTraces(
      {
        ...envelope,
        data: {
          traces: [
            {
              blockHash: hash,
              blockNumber: "0x1",
              transactionHash: hash,
              transactionIndex: "0x0",
              traceAddress: undefined,
              status: "0x1",
              type: "CALL",
              from: address,
              input: "0x",
            },
          ],
        },
      } as never,
      request("eth_queryTraces"),
    ),
  ).toThrow("'trace.traceAddress'");
});

test("standardizeQueryTransfers validates relation metadata and bounds", () => {
  const block = {
    hash,
    number: "0x1",
    timestamp: "0x1",
    logsBloom: "0x",
    parentHash: hash,
  };
  const transaction = {
    hash,
    transactionHash: hash,
    transactionIndex: "0x0",
    blockNumber: "0x1",
    blockHash: hash,
    from: address,
    status: "0x1",
  };
  const transfer = {
    blockHash: hash,
    blockNumber: "0x1",
    transactionHash: hash,
    transactionIndex: "0x0",
    traceAddress: [],
    from: address,
    value: "0x1",
    status: "0x1",
  };

  expect(() =>
    standardizeQueryTransfers(
      {
        ...envelope,
        data: { transfers: [{ ...transfer, blockHash: undefined }] },
      } as never,
      request("eth_queryTransfers"),
    ),
  ).toThrow("'transfer.blockHash'");

  expect(() =>
    standardizeQueryTransfers(
      {
        ...envelope,
        data: {
          blocks: [block],
          transactions: [
            { ...transaction, transactionIndex: "0x10000000000000000" },
          ],
          transfers: [transfer],
        },
      } as never,
      request("eth_queryTransfers"),
    ),
  ).toThrow("'transaction.transactionIndex'");
});

test("standardizeQuery relations use block and transaction primary keys", () => {
  const block = {
    hash,
    number: "0x1",
    timestamp: "0x1",
    logsBloom: "0x",
    parentHash: hash,
  };
  const transaction = {
    hash,
    transactionHash: hash,
    transactionIndex: "0x1",
    blockNumber: "0x1",
    blockHash: hash,
    from: address,
    status: "0x1",
  };
  const fields = {
    logs: true,
    traces: true,
    transfers: true,
    transactions: true,
    blocks: true,
  };

  expect(() =>
    standardizeQueryLogs(
      {
        ...envelope,
        data: {
          blocks: [block],
          transactions: [transaction],
          logs: [
            {
              blockNumber: "0x1",
              logIndex: "0x0",
              blockHash: hash,
              address,
              topics: [],
              data: "0x",
              transactionHash: hash,
              transactionIndex: "0x1",
            },
          ],
        },
      } as never,
      request("eth_queryLogs", { fields }),
    ),
  ).not.toThrow();

  expect(() =>
    standardizeQueryTraces(
      {
        ...envelope,
        data: {
          blocks: [block],
          transactions: [transaction],
          traces: [
            {
              blockHash: hash,
              blockNumber: "0x1",
              transactionHash: hash,
              transactionIndex: "0x1",
              traceAddress: [],
              status: "0x1",
              type: "CALL",
              from: address,
              input: "0x",
            },
          ],
        },
      } as never,
      request("eth_queryTraces", { fields }),
    ),
  ).not.toThrow();

  expect(() =>
    standardizeQueryTransfers(
      {
        ...envelope,
        data: {
          blocks: [block],
          transactions: [transaction],
          transfers: [
            {
              blockHash: hash,
              blockNumber: "0x1",
              transactionHash: hash,
              transactionIndex: "0x1",
              traceAddress: [],
              from: address,
              value: "0x1",
              status: "0x1",
            },
          ],
        },
      } as never,
      request("eth_queryTransfers", { fields }),
    ),
  ).not.toThrow();

  expect(() =>
    standardizeQueryLogs(
      {
        ...envelope,
        data: {
          blocks: [block],
          transactions: [{ ...transaction, transactionIndex: "0x0" }],
          logs: [
            {
              blockNumber: "0x1",
              logIndex: "0x0",
              blockHash: hash,
              address,
              topics: [],
              data: "0x",
              transactionHash: hash,
              transactionIndex: "0x1",
            },
          ],
        },
      } as never,
      request("eth_queryLogs", { fields }),
    ),
  ).toThrow("'log.transactionIndex'");
});
