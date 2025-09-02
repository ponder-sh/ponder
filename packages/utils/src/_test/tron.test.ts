import { RpcError, numberToHex } from "viem";
import { expect, test } from "vitest";
import { getLogsRetryHelper } from "../getLogsRetryHelper.js";
import { type Params, getRequest } from "./utils.js";

const request = getRequest("https://api.trongrid.io/jsonrpc");
const fromBlock = 71583814n;
const maxBlockRange = 5000n;
// THePheuMzpeYaEscvEPJhmvzjvQAq1ptqe from https://tronscan.org/#/tools/code-converter/tron-ethereum-address
const TEST_ADDRESS = "0x543208eB34ecad8f91a4D83e597d3c39D67ca47B";

test("tron success", async () => {
  const logs = await request({
    method: "eth_getLogs",
    params: [
      {
        address: TEST_ADDRESS,
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(fromBlock + maxBlockRange),
      },
    ],
  });

  expect(logs).toHaveLength(4);
});

test("tron response size", async () => {
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
  expect(JSON.stringify(error)).includes("exceed max block range");

  const retry = getLogsRetryHelper({
    params,
    error: error,
  });

  expect(retry.shouldRetry).toBe(true);
  expect(retry.ranges).toHaveLength(2);
  expect(retry.ranges![0]).toStrictEqual({
    fromBlock: numberToHex(fromBlock),
    toBlock: numberToHex(fromBlock + maxBlockRange - 1n),
  });
});
