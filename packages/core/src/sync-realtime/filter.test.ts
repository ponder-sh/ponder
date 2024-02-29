import { erc20ABI, pairABI } from "@/_test/generated.js";
import { setupAnvil } from "@/_test/setup.js";
import { publicClient } from "@/_test/utils.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { getAbiItem, getEventSelector, toHex } from "viem";
import { beforeEach, expect, test } from "vitest";
import { filterLogs } from "./filter.js";
import type { RealtimeLog } from "./format.js";

const zeroHash =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

beforeEach((context) => setupAnvil(context));

const AliceHex = toLowerCase(
  "0x000000000000000000000000f39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
);

const BobHex = toLowerCase(
  "0x00000000000000000000000070997970C51812dc3A010C7d01b50e0d17dc79C8",
);

const getLogs = async () => {
  const blockNumber = await publicClient.getBlockNumber();
  return publicClient.request({
    method: "eth_getLogs",
    params: [{ fromBlock: toHex(blockNumber - 3n) }],
  }) as Promise<RealtimeLog[]>;
};

test("filterLogs handles one logFilter, one address", async (context) => {
  const logs = await getLogs();

  const filteredLogs = filterLogs({
    logs,
    logFilters: [{ address: context.erc20.address }],
  });

  expect(filteredLogs).toHaveLength(2);
  expect(filteredLogs[0].address).toEqual(context.erc20.address);
  expect(filteredLogs[1].address).toEqual(context.erc20.address);
});

test("filterLogs handles one logFilter, two addresses", async (context) => {
  const logs = await getLogs();

  const filteredLogs = filterLogs({
    logs,
    logFilters: [
      {
        address: [context.erc20.address, context.factory.address],
      },
    ],
  });

  expect(filteredLogs).toHaveLength(3);
  expect(filteredLogs[0].address).toEqual(context.erc20.address);
  expect(filteredLogs[1].address).toEqual(context.erc20.address);
  expect(filteredLogs[2].address).toEqual(context.factory.address);
});

test("filterLogs handles empty array of addresses", async () => {
  const logs = await getLogs();

  const filteredLogs = filterLogs({
    logs,
    logFilters: [{ address: [] }],
  });

  expect(filteredLogs).toStrictEqual(logs);
  expect(logs).toHaveLength(4);
});

test("filterLogs handles two logFilters, one address each", async (context) => {
  const logs = await getLogs();

  const filteredLogs = filterLogs({
    logs,
    logFilters: [
      { address: context.erc20.address },
      { address: context.factory.address },
    ],
  });

  expect(filteredLogs).toHaveLength(3);
  expect(filteredLogs[0].address).toEqual(context.erc20.address);
  expect(filteredLogs[1].address).toEqual(context.erc20.address);
  expect(filteredLogs[2].address).toEqual(context.factory.address);
});

test("filterLogs handles one logFilter, one topic", async (context) => {
  const logs = await getLogs();

  const filteredLogs = filterLogs({
    logs,
    logFilters: [
      {
        topics: [
          getEventSelector(getAbiItem({ abi: erc20ABI, name: "Transfer" })),
          null,
          null,
          null,
        ],
      },
    ],
  });

  expect(filteredLogs).toHaveLength(2);
  expect(filteredLogs[0].address).toEqual(context.erc20.address);
  expect(filteredLogs[1].address).toEqual(context.erc20.address);
});

test("filterLogs handles one logFilter, many topics", async () => {
  const logs = await getLogs();

  const filteredLogs = filterLogs({
    logs,
    logFilters: [
      {
        topics: [
          getEventSelector(getAbiItem({ abi: erc20ABI, name: "Transfer" })),
          AliceHex,
          null,
          null,
        ],
      },
    ],
  });

  // Should match log 1 only.
  expect(filteredLogs).toHaveLength(1);
  expect(filteredLogs[0].topics).toMatchObject([
    getEventSelector(getAbiItem({ abi: erc20ABI, name: "Transfer" })),
    AliceHex,
    BobHex,
  ]);
});

test("filterLogs handles two logFilters, one topic each", async () => {
  const logs = await getLogs();

  const filteredLogs = filterLogs({
    logs,
    logFilters: [
      {
        topics: [null, zeroHash, null, null],
      },
      {
        topics: [null, null, BobHex, null],
      },
    ],
  });

  // Should match log 1 and 3.
  expect(filteredLogs).toHaveLength(2);
  expect(filteredLogs[0].topics).toMatchObject([
    getEventSelector(getAbiItem({ abi: erc20ABI, name: "Transfer" })),
    zeroHash,
    AliceHex,
  ]);
  expect(filteredLogs[1].topics).toEqual([
    getEventSelector(getAbiItem({ abi: erc20ABI, name: "Transfer" })),
    AliceHex,
    BobHex,
  ]);
});

test("filterLogs handles one logFilter, one topic, list of values", async () => {
  const logs = await getLogs();

  const filteredLogs = filterLogs({
    logs,
    logFilters: [
      {
        topics: [null, null, [AliceHex, BobHex], null],
      },
    ],
  });

  expect(filteredLogs).toHaveLength(3);
  expect(filteredLogs[0].topics).toMatchObject([
    getEventSelector(getAbiItem({ abi: erc20ABI, name: "Transfer" })),
    zeroHash,
    AliceHex,
  ]);
  expect(filteredLogs[1].topics).toEqual([
    getEventSelector(getAbiItem({ abi: erc20ABI, name: "Transfer" })),
    AliceHex,
    BobHex,
  ]);
  expect(filteredLogs[2].topics).toEqual([
    getEventSelector(getAbiItem({ abi: pairABI, name: "Swap" })),
    AliceHex,
    AliceHex,
  ]);
});
