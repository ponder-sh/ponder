import { RpcError, numberToHex } from "viem";
import { expect, test } from "vitest";
import { getLogsRetryHelper } from "../getLogsRetryHelper.js";
import { type Params, getRequest } from "./utils.js";

const request = getRequest("https://rpc.hyperliquid.xyz/evm");
const fromBlock = 9419400;
const maxBlockRange = 50;

test.skip("hyperliquid success", async () => {
  const logs = await request({
    method: "eth_getLogs",
    params: [
      {
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(fromBlock + maxBlockRange),
      },
    ],
  });

  expect(logs).toHaveLength(5);
});

test.skip("hyperliquid block range", async () => {
  const params: Params = [
    {
      fromBlock: numberToHex(fromBlock),
      toBlock: numberToHex(fromBlock + maxBlockRange + 1),
    },
  ];

  const error = await request({
    method: "eth_getLogs",
    params,
  }).catch((error) => error);

  expect(error).toBeInstanceOf(RpcError);
  expect(JSON.stringify(error)).includes("query exceeds max block range 50");

  const retry = getLogsRetryHelper({
    params,
    error: error,
  });

  expect(retry).toStrictEqual({
    shouldRetry: true,
    isSuggestedRange: true,
    ranges: [
      {
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(fromBlock + maxBlockRange),
      },
      {
        fromBlock: numberToHex(fromBlock + maxBlockRange + 1),
        toBlock: numberToHex(fromBlock + maxBlockRange + 1),
      },
    ],
  });
});
