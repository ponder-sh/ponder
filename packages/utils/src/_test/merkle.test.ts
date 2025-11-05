import { RpcError, numberToHex } from "viem";
import { expect, test } from "vitest";
import { getLogsRetryHelper } from "../getLogsRetryHelper.js";
import { type Params, UNI, WETH, fromBlock, getRequest } from "./utils.js";

const request = getRequest("https://eth.merkle.io");
const maxBlockRange10k = 10_000n;
const maxBlockRange1k = 1_000n;

test("merkle success 10k", async () => {
  const logs = await request({
    method: "eth_getLogs",
    params: [
      {
        address: UNI,
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(fromBlock + maxBlockRange10k),
      },
    ],
  });

  expect(logs).toHaveLength(49);
});

test("merkle block range 10k", async () => {
  const params: Params = [
    {
      address: WETH,
      fromBlock: numberToHex(fromBlock),
      toBlock: numberToHex(fromBlock + maxBlockRange10k + 1n),
    },
  ];

  const error = await request({
    method: "eth_getLogs",
    params,
  }).catch((error) => error);

  expect(error).toBeInstanceOf(RpcError);
  expect(JSON.stringify(error)).includes(
    "eth_getLogs range is too large, max is 10k blocks",
  );

  const retry = getLogsRetryHelper({
    params,
    error,
  });

  expect(retry.shouldRetry).toBe(true);
  expect(retry).toStrictEqual({
    isSuggestedRange: true,
    shouldRetry: true,
    ranges: [
      {
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(fromBlock + maxBlockRange10k),
      },
      {
        fromBlock: numberToHex(fromBlock + maxBlockRange10k + 1n),
        toBlock: numberToHex(fromBlock + maxBlockRange10k + 1n),
      },
    ],
  });
});

test("merkle success 1k", async () => {
  const logs = await request({
    method: "eth_getLogs",
    params: [
      {
        address: UNI,
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(fromBlock + maxBlockRange1k),
      },
    ],
  });

  expect(logs).toHaveLength(9);
});

test("merkle block range 1k", async () => {
  const params: Params = [
    {
      address: WETH,
      fromBlock: numberToHex(fromBlock),
      toBlock: numberToHex(fromBlock + maxBlockRange1k + 1n),
    },
  ];

  const error = await request({
    method: "eth_getLogs",
    params,
  }).catch((error) => error);

  expect(error).toBeInstanceOf(RpcError);
  expect(JSON.stringify(error)).includes(
    "eth_getLogs range is too large, max is 1k blocks",
  );

  const retry = getLogsRetryHelper({
    params,
    error,
  });

  expect(retry.shouldRetry).toBe(true);
  expect(retry).toStrictEqual({
    isSuggestedRange: true,
    shouldRetry: true,
    ranges: [
      {
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(fromBlock + maxBlockRange1k),
      },
      {
        fromBlock: numberToHex(fromBlock + maxBlockRange1k + 1n),
        toBlock: numberToHex(fromBlock + maxBlockRange1k + 1n),
      },
    ],
  });
});
