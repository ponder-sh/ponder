import { RpcError, numberToHex } from "viem";
import { expect, test } from "vitest";
import { getLogsRetryHelper } from "../getLogsRetryHelper.js";
import { type Params, UNI, fromBlock, getRequest } from "./utils.js";

const request = getRequest(process.env.RPC_URL_ANKR_1!);
const maxBlockRange = 3000n;

test("ankr success", async () => {
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

  expect(logs).toHaveLength(13);
});

test("ankr response size", async () => {
  const params: Params = [
    {
      fromBlock: numberToHex(fromBlock),
      toBlock: numberToHex(fromBlock + maxBlockRange + 1n),
    },
  ];

  const error = await request({
    method: "eth_getLogs",
    params,
  }).catch((error) => error);

  expect(error).toBeInstanceOf(RpcError);
  expect(JSON.stringify(error)).includes("query exceeds max results");

  const retry = getLogsRetryHelper({
    params,
    error: error,
  });

  expect(retry.shouldRetry).toBe(true);
  expect(retry.ranges).toHaveLength(2);
  expect(retry.ranges![0]).toStrictEqual({
    fromBlock: numberToHex(fromBlock),
    toBlock: numberToHex(fromBlock + maxBlockRange / 2n),
  });
});
