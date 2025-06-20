import { InvalidInputRpcError, numberToHex } from "viem";
import { harmonyOne } from "viem/chains";
import { expect, test } from "vitest";
import { getLogsRetryHelper } from "../getLogsRetryHelper.js";
import { type Params, getRequest } from "./utils.js";

const request = getRequest("https://api.harmony.one", harmonyOne);
const fromBlock = 70_000_000n;
const maxBlockRange = 1024n;

test(
  "harmony success",
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

    expect(logs).toHaveLength(703);
  },
  { timeout: 15_000 },
);

test(
  "harmony block range",
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

    expect(error).toBeInstanceOf(InvalidInputRpcError);
    expect(JSON.stringify(error)).includes(
      "query must be smaller than size 1024",
    );

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
