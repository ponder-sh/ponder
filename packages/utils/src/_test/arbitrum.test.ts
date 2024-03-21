import { InvalidInputRpcError, numberToHex } from "viem";
import { expect, test } from "vitest";
import { getLogsRetryHelper } from "../getLogsRetryHelper.js";
import { type Params, getRequest } from "./utils.js";

const request = getRequest("https://arb1.arbitrum.io/rpc");
const fromBlock = 1_000_000n;

test(
  "arbitrum success",
  async () => {
    const logs = await request({
      method: "eth_getLogs",
      params: [
        {
          address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
          fromBlock: numberToHex(fromBlock),
          toBlock: numberToHex(fromBlock + 1_000n),
        },
      ],
    });

    expect(logs).toHaveLength(714);
  },
  { timeout: 15_000 },
);

test(
  "arbitrum response size",
  async () => {
    const params: Params = [
      {
        address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(fromBlock + 20_000n),
      },
    ];

    const error = await request({
      method: "eth_getLogs",
      params,
    }).catch((error) => error);

    expect(error).toBeInstanceOf(InvalidInputRpcError);
    expect(JSON.stringify(error)).includes(
      "logs matched by query exceeds limit of 10000",
    );

    const retry = getLogsRetryHelper({
      params,
      error,
    });

    expect(retry.shouldRetry).toBe(true);
    expect(retry.ranges).toHaveLength(2);
    expect(retry.ranges![0]).toStrictEqual({
      fromBlock: numberToHex(fromBlock),
      toBlock: numberToHex(fromBlock + 10_000n),
    });
  },
  { timeout: 15_000 },
);
