import { RpcRequestError, numberToHex } from "viem";
import { expect, test } from "vitest";
import { getLogsRetryHelper } from "../getLogsRetryHelper.js";
import { type Params, getRequest } from "./utils.js";

const request = getRequest("https://mainnet.optimism.io");
const fromBlock = 100_000_000n;

test(
  "optimism success",
  async () => {
    const logs = await request({
      method: "eth_getLogs",
      params: [
        {
          address: "0x871f2F2ff935FD1eD867842FF2a7bfD051A5E527",
          fromBlock: numberToHex(fromBlock),
          toBlock: numberToHex(fromBlock + 1_000n),
        },
      ],
    });

    expect(logs).toHaveLength(0);
  },
  { timeout: 15_000 },
);

// Reported as block range but behaves inconsistently
test(
  "optimism block range",
  async () => {
    const params: Params = [
      {
        address: "0x4200000000000000000000000000000000000006",
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(fromBlock + 10_000n),
      },
    ];

    const error = await request({
      method: "eth_getLogs",
      params,
    }).catch((error) => error);

    expect(error).toBeInstanceOf(RpcRequestError);
    expect(JSON.stringify(error)).includes("Block range is too large");

    const retry = getLogsRetryHelper({
      params,
      error,
    });

    expect(retry.shouldRetry).toBe(true);
    expect(retry.ranges).toHaveLength(2);
    expect(retry.ranges![0]).toStrictEqual({
      fromBlock: numberToHex(fromBlock),
      toBlock: numberToHex(fromBlock + 5_000n),
    });
  },
  { timeout: 15_000 },
);
