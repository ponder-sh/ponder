import { InternalRpcError, numberToHex } from "viem";
import { moonriver } from "viem/chains";
import { expect, test } from "vitest";
import { getLogsRetryHelper } from "../getLogsRetryHelper.js";
import { type Params, getRequest } from "./utils.js";

const request = getRequest(
  "https://rpc.api.moonriver.moonbeam.network",
  moonriver,
);
const fromBlock = 12_000_000n;
const maxBlockRange = 1024n;

test(
  "moonriver success",
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
  "moonriver block range",
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

    expect(error).toBeInstanceOf(InternalRpcError);
    expect(JSON.stringify(error)).includes(
      "block range is too wide (maximum 1024)",
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
