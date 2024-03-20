import { LimitExceededRpcError, numberToHex } from "viem";
import { expect, test } from "vitest";
import { getLogsRetryHelper } from "../getLogsRetryHelper.js";
import { type Params, UNI, WETH, fromBlock, getRequest } from "./utils.js";

const request = getRequest(process.env.RPC_URL_INFURA_1!);

test(
  "infura success",
  async () => {
    const logs = await request({
      method: "eth_getLogs",
      params: [
        {
          address: UNI,
          fromBlock: numberToHex(fromBlock),
          toBlock: numberToHex(fromBlock + 1_000n),
        },
      ],
    });

    expect(logs).toHaveLength(9);
  },
  { timeout: 15_000 },
);

test("infura block range", async () => {
  const params: Params = [
    {
      address: WETH,
      fromBlock: numberToHex(fromBlock),
      toBlock: numberToHex(fromBlock + 1_000n),
    },
  ];

  const error = await request({
    method: "eth_getLogs",
    params,
  }).catch((error) => error);

  expect(error).toBeInstanceOf(LimitExceededRpcError);
  expect(JSON.stringify(error)).includes("Try with this block range ");

  const retry = getLogsRetryHelper({
    params,
    error,
  });

  expect(retry.shouldRetry).toBe(true);
  expect(retry.ranges).toHaveLength(8);
  expect(retry.ranges![0]).toStrictEqual({
    fromBlock: "0x112a880",
    toBlock: "0x112a907",
  });
});
