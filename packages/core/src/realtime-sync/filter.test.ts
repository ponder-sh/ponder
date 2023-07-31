import type { RpcLog } from "viem";
import { expect, test } from "vitest";

import { filterLogs } from "./filter.js";

export const logs: RpcLog[] = [
  {
    address: "0x15d4c048f83bd7e37d49ea4c83a07267ec4203da",
    blockHash:
      "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
    blockNumber: "0xe6e55f",
    data: "0x0000000000000000000000000000000000000000000000000000002b3b6fb3d0",
    logIndex: "0x6c",
    removed: false,
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      "0x000000000000000000000000a00f99bc38b1ecda1fd70eaa1cd31d576a9f46b0",
      "0x000000000000000000000000f16e9b0d03470827a95cdfd0cb8a8a3b46969b91",
    ],
    transactionHash:
      "0xa4b1f606b66105fa45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98b",
    transactionIndex: "0x45",
  },
  {
    address: "0x72d4c048f83bd7e37d49ea4c83a07267ec4203da",
    blockHash:
      "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
    blockNumber: "0xe6e55f",
    data: "0x0000000000000000000000000000000000000000000000000000002b3b6fb3d0",
    logIndex: "0x6d",
    removed: false,
    topics: [],
    transactionHash:
      "0xc3f1f606b66105fa45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98b",
    transactionIndex: "0x46",
  },
  {
    address: "0xa4b1f606b66105fa45cb5db23d2f6597075701ea",
    blockHash:
      "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
    blockNumber: "0xe6e55f",
    data: "0x0000000000000000000000000000000000000000000000000000002b3b6fb3d0",
    logIndex: "0x6d",
    removed: false,
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      "0x45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98bc3f1f606b66105fa",
    ],
    transactionHash:
      "0xc3f1f606b66105fa45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98b",
    transactionIndex: "0x46",
  },
];

test("filterLogs handles one logFilter, one address", () => {
  const filteredLogs = filterLogs({
    logs,
    logFilters: [{ address: "0x15d4c048f83bd7e37d49ea4c83a07267ec4203da" }],
  });

  expect(filteredLogs).toHaveLength(1);
  expect(filteredLogs[0].address).toEqual(
    "0x15d4c048f83bd7e37d49ea4c83a07267ec4203da"
  );
});

test("filterLogs handles one logFilter, two addresses", () => {
  const filteredLogs = filterLogs({
    logs,
    logFilters: [
      {
        address: [
          "0x15d4c048f83bd7e37d49ea4c83a07267ec4203da",
          "0x72d4c048f83bd7e37d49ea4c83a07267ec4203da",
        ],
      },
    ],
  });

  expect(filteredLogs).toHaveLength(2);
  expect(filteredLogs[0].address).toEqual(
    "0x15d4c048f83bd7e37d49ea4c83a07267ec4203da"
  );
  expect(filteredLogs[1].address).toEqual(
    "0x72d4c048f83bd7e37d49ea4c83a07267ec4203da"
  );
});

test("filterLogs handles two logFilters, one address each", () => {
  const filteredLogs = filterLogs({
    logs,
    logFilters: [
      { address: "0x15d4c048f83bd7e37d49ea4c83a07267ec4203da" },
      { address: "0x72d4c048f83bd7e37d49ea4c83a07267ec4203da" },
    ],
  });

  expect(filteredLogs).toHaveLength(2);
  expect(filteredLogs[0].address).toEqual(
    "0x15d4c048f83bd7e37d49ea4c83a07267ec4203da"
  );
  expect(filteredLogs[1].address).toEqual(
    "0x72d4c048f83bd7e37d49ea4c83a07267ec4203da"
  );
});

test("filterLogs handles one logFilter, one topic", () => {
  const filteredLogs = filterLogs({
    logs,
    logFilters: [
      {
        topics: [
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        ],
      },
    ],
  });

  // Should match log 1 and 3.
  expect(filteredLogs).toHaveLength(2);
  expect(filteredLogs[0].topics).toMatchObject([
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    "0x000000000000000000000000a00f99bc38b1ecda1fd70eaa1cd31d576a9f46b0",
    "0x000000000000000000000000f16e9b0d03470827a95cdfd0cb8a8a3b46969b91",
  ]);
  expect(filteredLogs[1].topics).toEqual([
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    "0x45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98bc3f1f606b66105fa",
  ]);
});

test("filterLogs handles one logFilter, many topics", () => {
  const filteredLogs = filterLogs({
    logs,
    logFilters: [
      {
        topics: [
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          null,
          "0x000000000000000000000000f16e9b0d03470827a95cdfd0cb8a8a3b46969b91",
        ],
      },
    ],
  });

  // Should match log 1 only.
  expect(filteredLogs).toHaveLength(1);
  expect(filteredLogs[0].topics).toMatchObject([
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    "0x000000000000000000000000a00f99bc38b1ecda1fd70eaa1cd31d576a9f46b0",
    "0x000000000000000000000000f16e9b0d03470827a95cdfd0cb8a8a3b46969b91",
  ]);
});

test("filterLogs handles two logFilters, one topic each", () => {
  const filteredLogs = filterLogs({
    logs,
    logFilters: [
      {
        topics: [
          null,
          null,
          "0x000000000000000000000000f16e9b0d03470827a95cdfd0cb8a8a3b46969b91",
        ],
      },
      {
        topics: [
          null,
          "0x45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98bc3f1f606b66105fa",
        ],
      },
    ],
  });

  // Should match log 1 and 3.
  expect(filteredLogs).toHaveLength(2);
  expect(filteredLogs[0].topics).toMatchObject([
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    "0x000000000000000000000000a00f99bc38b1ecda1fd70eaa1cd31d576a9f46b0",
    "0x000000000000000000000000f16e9b0d03470827a95cdfd0cb8a8a3b46969b91",
  ]);
  expect(filteredLogs[1].topics).toEqual([
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    "0x45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98bc3f1f606b66105fa",
  ]);
});

test("filterLogs handles one logFilter, one topic, list of values", () => {
  const filteredLogs = filterLogs({
    logs,
    logFilters: [
      {
        topics: [
          null,
          [
            "0x000000000000000000000000a00f99bc38b1ecda1fd70eaa1cd31d576a9f46b0",
            "0x45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98bc3f1f606b66105fa",
          ],
          null,
        ],
      },
    ],
  });

  // Should match log 1 and 3.
  expect(filteredLogs).toHaveLength(2);
  expect(filteredLogs[0].topics).toMatchObject([
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    "0x000000000000000000000000a00f99bc38b1ecda1fd70eaa1cd31d576a9f46b0",
    "0x000000000000000000000000f16e9b0d03470827a95cdfd0cb8a8a3b46969b91",
  ]);
  expect(filteredLogs[1].topics).toEqual([
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    "0x45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98bc3f1f606b66105fa",
  ]);
});
