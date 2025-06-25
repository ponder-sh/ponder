import { LimitExceededRpcError, numberToHex } from "viem";
import { aurora } from "viem/chains";
import { expect, test } from "vitest";
import { getLogsRetryHelper } from "../getLogsRetryHelper.js";
import { type Params, getRequest } from "./utils.js";

const request = getRequest("https://mainnet.aurora.dev", aurora);
const fromBlock = 57_600_000n;
const maxBlockRange = 2000n;

test(
  "aurora success",
  async () => {
    const logs = await request({
      method: "eth_getLogs",
      params: [
        {
          fromBlock: numberToHex(fromBlock),
          toBlock: numberToHex(fromBlock + maxBlockRange),
        },
      ],
    });

    expect(logs).toBeDefined();
  },
  { timeout: 15_000 },
);

test(
  "aurora block range",
  async () => {
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

    expect(error).toBeInstanceOf(LimitExceededRpcError);
    expect(JSON.stringify(error)).includes("up to a 2000 block range");

    const retry = getLogsRetryHelper({
      params,
      error,
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
          fromBlock: numberToHex(fromBlock + maxBlockRange + 1n),
          toBlock: numberToHex(fromBlock + maxBlockRange + 1n),
        },
      ],
    });
  },
  { timeout: 15_000 },
);
