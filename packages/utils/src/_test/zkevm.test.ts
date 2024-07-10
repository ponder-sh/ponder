import { RpcError, numberToHex } from "viem";
import { expect, test } from "vitest";
import { getLogsRetryHelper } from "../getLogsRetryHelper.js";
import { type Params, getRequest } from "./utils.js";

const request = getRequest("https://zkevm-rpc.com");

const fromBlock = 950_000n;

test("zkevm success", async () => {
  const logs = await request({
    method: "eth_getLogs",
    params: [
      {
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(fromBlock + 1_000n),
      },
    ],
  });

  expect(logs).toHaveLength(2979);
});

test("zkevm response size", async () => {
  const params: Params = [
    {
      fromBlock: numberToHex(fromBlock),
      toBlock: numberToHex(fromBlock + 5_000n),
    },
  ];

  const error = await request({
    method: "eth_getLogs",
    params,
  }).catch((error) => error);

  expect(error).toBeInstanceOf(RpcError);
  expect(JSON.stringify(error)).includes(
    "query returned more than 10000 results",
  );

  const retry = getLogsRetryHelper({
    params,
    error: error,
  });

  expect(retry.shouldRetry).toBe(true);
  expect(retry.ranges).toHaveLength(2);
});
