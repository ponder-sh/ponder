import { numberToHex } from "viem";
import { expect, test } from "vitest";
import { getLogsRetryHelper } from "../getLogsRetryHelper.js";
import { type Params, getRequest } from "./utils.js";

const request = getRequest("https://mainnet.base.org");
const fromBlock = 10_000_000n;

test(
  "base success",
  async () => {
    const logs = await request({
      method: "eth_getLogs",
      params: [
        {
          address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
          fromBlock: numberToHex(fromBlock),
          toBlock: numberToHex(fromBlock + 1_000n),
        },
      ],
    });

    expect(logs).toHaveLength(77);
  },
  { timeout: 15_000 },
);

test(
  "base block range",
  async () => {
    const params: Params = [
      {
        address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(fromBlock + 20_000n),
      },
    ];

    const error = await request({
      method: "eth_getLogs",
      params,
    }).catch((error) => error);

    expect(JSON.stringify(error)).includes(
      "no backend is currently healthy to serve traffic",
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
