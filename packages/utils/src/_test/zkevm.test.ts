import { RpcError, numberToHex } from "viem";
import { expect, test } from "vitest";
import { getLogsRetryHelper } from "../getLogsRetryHelper.js";
import { type Params, getRequest } from "./utils.js";

const request = getRequest("https://zkevm-rpc.com");

const fromBlock = 950_000n;
const maxBlockRange = 10_000n;

test("zksync success", async () => {
  const logs = await request({
    method: "eth_getLogs",
    params: [
      {
        address: "0xea034fb02eb1808c2cc3adbc15f447b93cbe08e1",
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(fromBlock + maxBlockRange),
      },
    ],
  });

  expect(logs).toHaveLength(35);
});

test("zksync block range", async () => {
  const params: Params = [
    {
      address: "0xea034fb02eb1808c2cc3adbc15f447b93cbe08e1",
      fromBlock: numberToHex(fromBlock),
      toBlock: numberToHex(fromBlock + maxBlockRange + 1n),
    },
  ];

  const error = await request({
    method: "eth_getLogs",
    params,
  }).catch((error) => error);

  expect(error).toBeInstanceOf(RpcError);

  const retry = getLogsRetryHelper({
    params,
    error: error,
  });

  expect(retry).toStrictEqual({
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
