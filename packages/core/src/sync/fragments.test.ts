import { buildLogFactory } from "@/build/factory.js";
import { parseAbiItem } from "viem";
import { expect, test } from "vitest";
import { buildLogFilterFragments } from "./fragments.js";

const llamaFactoryEventAbiItem = parseAbiItem(
  "event LlamaInstanceCreated(address indexed deployer, string indexed name, address llamaCore, address llamaExecutor, address llamaPolicy, uint256 chainId)",
);

test("buildLogFilterFragments generates 1 log filter fragment for null filter", () => {
  const logFilterFragments = buildLogFilterFragments({
    type: "log",
    chainId: 1,
    address: undefined,
    topics: [null, null, null, null],
    includeTransactionReceipts: false,
  });

  expect(logFilterFragments).toMatchObject([
    {
      id: "1_null_null_null_null_null_0",
      address: null,
      topic0: null,
      topic1: null,
      topic2: null,
      topic3: null,
      includeTransactionReceipts: 0,
    },
  ]);
});

test("buildLogFilterFragments generates 1 log filter fragment for simple filter", () => {
  const logFilterFragments = buildLogFilterFragments({
    type: "log",
    chainId: 1,
    address: "0xa",
    topics: [null, null, null, null],
    includeTransactionReceipts: false,
  });

  expect(logFilterFragments).toMatchObject([
    {
      id: "1_0xa_null_null_null_null_0",
      address: "0xa",
      topic0: null,
      topic1: null,
      topic2: null,
      topic3: null,
      includeTransactionReceipts: 0,
    },
  ]);
});

test("buildLogFilterFragments generates 4 log filter fragment for 2x2 filter", () => {
  const logFilterFragments = buildLogFilterFragments({
    type: "log",
    chainId: 115511,
    address: ["0xa", "0xb"],
    topics: [["0xc", "0xd"], null, "0xe", null],
    includeTransactionReceipts: false,
  });

  expect(logFilterFragments).toMatchObject([
    {
      id: "115511_0xa_0xc_null_0xe_null_0",
      address: "0xa",
      topic0: "0xc",
      topic1: null,
      topic2: "0xe",
      topic3: null,
      includeTransactionReceipts: 0,
    },
    {
      id: "115511_0xa_0xd_null_0xe_null_0",
      address: "0xa",
      topic0: "0xd",
      topic1: null,
      topic2: "0xe",
      topic3: null,
      includeTransactionReceipts: 0,
    },
    {
      id: "115511_0xb_0xc_null_0xe_null_0",
      address: "0xb",
      topic0: "0xc",
      topic1: null,
      topic2: "0xe",
      topic3: null,
      includeTransactionReceipts: 0,
    },
    {
      id: "115511_0xb_0xd_null_0xe_null_0",
      address: "0xb",
      topic0: "0xd",
      topic1: null,
      topic2: "0xe",
      topic3: null,
      includeTransactionReceipts: 0,
    },
  ]);
});

test("buildLogFilterFragments generates 12 log filter fragment for 2x2x3 filter", () => {
  const logFilterFragments = buildLogFilterFragments({
    type: "log",
    chainId: 1,
    address: ["0xa", "0xb"],
    topics: [["0xc", "0xd"], null, ["0xe", "0xf", "0x1"], null],
    includeTransactionReceipts: false,
  });

  expect(logFilterFragments.length).toBe(12);
});

test("buildLogFilterFragments includeTransactionReceipts", () => {
  const logFilterFragments = buildLogFilterFragments({
    type: "log",
    chainId: 1,
    address: undefined,
    topics: [null, null, null, null],
    includeTransactionReceipts: true,
  });

  expect(logFilterFragments).toMatchObject([
    {
      id: "1_null_null_null_null_null_1",
      address: null,
      topic0: null,
      topic1: null,
      topic2: null,
      topic3: null,
      includeTransactionReceipts: 1,
    },
  ]);
});

test("buildFactoryFragments builds id containing topic", () => {
  const addressFilter = buildLogFactory({
    address: "0xa",
    event: llamaFactoryEventAbiItem,
    parameter: "deployer",
    chainId: 1,
  });

  expect(
    buildLogFilterFragments({
      type: "log",
      chainId: 1,
      topics: [null, null, null, null],
      address: addressFilter,
      includeTransactionReceipts: false,
    })[0]!.id,
  ).toBe(
    "1_0xa_0x00fef2d461a2fabbb523f9f42752c61336f03b17a602af52cc6c83cb8b110599_topic1_null_null_null_null_0",
  );
});

test("buildFactoryFragments builds id containing offset", () => {
  const addressFilter = buildLogFactory({
    address: "0xa",
    event: llamaFactoryEventAbiItem,
    parameter: "llamaPolicy",
    chainId: 1,
  });

  expect(
    buildLogFilterFragments({
      type: "log",
      chainId: 115511,
      topics: [null, null, null, null],
      address: addressFilter,
      includeTransactionReceipts: false,
    })[0]!.id,
  ).toBe(
    "115511_0xa_0x00fef2d461a2fabbb523f9f42752c61336f03b17a602af52cc6c83cb8b110599_offset64_null_null_null_null_0",
  );
});
