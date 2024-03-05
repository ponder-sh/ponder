import { RpcError, numberToHex } from "viem";
import { expect, test } from "vitest";
import { getLogsRetryHelper } from "../getLogsRetryHelper.js";
import { type Params, UNI, WETH, fromBlock, getRequest } from "./utils.js";

const request = getRequest(process.env.RPC_URL_ALCHEMY_1!);
const maxBlockRange = 2000n;

test(
  "alchemy success response size",
  async () => {
    const logs = await request({
      method: "eth_getLogs",
      params: [
        {
          address: WETH,
          fromBlock: numberToHex(fromBlock),
          toBlock: numberToHex(fromBlock + maxBlockRange),
        },
      ],
    });

    expect(logs).toHaveLength(140192);
  },
  { timeout: 15_000 },
);

test("alchemy success block range", async () => {
  const logs = await request({
    method: "eth_getLogs",
    params: [
      {
        address: UNI,
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(fromBlock + 1_000_000n),
      },
    ],
  });

  expect(logs).toHaveLength(3773);
});

test("alchemy", async () => {
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

  const retry = getLogsRetryHelper({
    params,
    error,
  });

  expect(retry.shouldRetry).toBe(true);
  expect(retry.ranges).toHaveLength(30);
  expect(retry.ranges![0]).toStrictEqual({
    fromBlock: "0x112a880",
    toBlock: "0x112a8c2",
  });
});
