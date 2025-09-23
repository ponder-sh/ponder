import { HttpRequestError, numberToHex } from "viem";
import { expect, test } from "vitest";
import { getLogsRetryHelper } from "../getLogsRetryHelper.js";
import { type Params, getRequest } from "./utils.js";

const request = getRequest(process.env.RPC_URL_ALTITUDE_999!);
const fromBlock = 9419400;
const maxBlockRange = 29999;

test("hyperliquid success", async () => {
  const logs = await request({
    method: "eth_getLogs",
    params: [
      {
        address: "0xfD739d4e423301CE9385c1fb8850539D657C296D",
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(fromBlock + maxBlockRange),
      },
    ],
  });

  expect(logs).toHaveLength(4217);
});

test("hyperliquid block range", async () => {
  const params: Params = [
    {
      address: "0xfD739d4e423301CE9385c1fb8850539D657C296D",
      fromBlock: numberToHex(fromBlock),
      toBlock: numberToHex(fromBlock + maxBlockRange + 1),
    },
  ];

  const error = await request({
    method: "eth_getLogs",
    params,
  }).catch((error) => error);

  expect(error).toBeInstanceOf(HttpRequestError);
  expect(JSON.stringify(error)).includes(
    "allowed block range threshold exceeded",
  );

  const retry = getLogsRetryHelper({
    params,
    error: error,
  });

  expect(retry.shouldRetry).toBe(true);
  expect(retry.ranges).toHaveLength(2);
});

test("hyperliquid response size", async () => {
  const params: Params = [
    {
      fromBlock: numberToHex(fromBlock),
      toBlock: numberToHex(fromBlock + maxBlockRange),
    },
  ];

  const error = await request({
    method: "eth_getLogs",
    params,
  }).catch((error) => error);

  expect(error).toBeInstanceOf(HttpRequestError);
  expect(JSON.stringify(error)).includes("query exceeds max results 20000");

  const retry = getLogsRetryHelper({
    params,
    error: error,
  });

  expect(retry.shouldRetry).toBe(true);
  expect(retry.ranges).toHaveLength(2);
});
