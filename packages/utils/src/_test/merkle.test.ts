import { RpcError, numberToHex } from "viem";
import { expect, test } from "vitest";
import { getLogsRetryHelper } from "../getLogsRetryHelper.js";
import { type Params, UNI, WETH, fromBlock, getRequest } from "./utils.js";

const request = getRequest("https://eth.merkle.io");
const maxBlockRange = 10_000n;

test("merkle success", async () => {
  const logs = await request({
    method: "eth_getLogs",
    params: [
      {
        address: UNI,
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(fromBlock + maxBlockRange),
      },
    ],
  });

  expect(logs).toHaveLength(49);
});

test("merkle block range", async () => {
  const params: Params = [
    {
      address: WETH,
      fromBlock: numberToHex(fromBlock),
      toBlock: numberToHex(fromBlock + maxBlockRange + 1n),
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
        toBlock: numberToHex(fromBlock + maxBlockRange),
      },
      {
        fromBlock: numberToHex(fromBlock + maxBlockRange + 1n),
        toBlock: numberToHex(fromBlock + maxBlockRange + 1n),
      },
    ],
  });
});
