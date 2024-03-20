import { RpcError, numberToHex } from "viem";
import { expect, test } from "vitest";
import { getLogsRetryHelper } from "../getLogsRetryHelper.js";
import { type Params, getRequest } from "./utils.js";

const request = getRequest("https://mainnet.era.zksync.io");

const fromBlock = 18406545n;

test("zksync success", async () => {
  const logs = await request({
    method: "eth_getLogs",
    params: [
      {
        address: "0xfc00dac251711508d4dd7b0c310e913575988838",
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(fromBlock + 10_000n),
      },
    ],
  });

  expect(logs).toHaveLength(726);
});

test("zksync block range", async () => {
  const params: Params = [
    {
      address: "0xfc00dac251711508d4dd7b0c310e913575988838",
      fromBlock: numberToHex(fromBlock),
      toBlock: numberToHex(fromBlock + 50_000n),
    },
  ];

  const error = await request({
    method: "eth_getLogs",
    params,
  }).catch((error) => error);

  expect(error).toBeInstanceOf(RpcError);
  expect(JSON.stringify(error)).includes("Try with this block range ");

  const retry = getLogsRetryHelper({
    params,
    error: error,
  });

  expect(retry).toStrictEqual({
    shouldRetry: true,
    ranges: [
      {
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(fromBlock + 45106n),
      },
      {
        fromBlock: numberToHex(fromBlock + 45106n + 1n),
        toBlock: numberToHex(fromBlock + 50_000n),
      },
    ],
  });
});
