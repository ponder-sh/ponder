import { buildLogFactory } from "@/build/factory.js";
import { parseAbiItem } from "viem";
import { expect, test } from "vitest";
import { getLogFilterFragmentIds } from "./fragments.js";

const llamaFactoryEventAbiItem = parseAbiItem(
  "event LlamaInstanceCreated(address indexed deployer, string indexed name, address llamaCore, address llamaExecutor, address llamaPolicy, uint256 chainId)",
);

test("getLogFilterFragmentIds generates 1 log filter fragment for null filter", () => {
  const logFilterFragments = getLogFilterFragmentIds({
    type: "log",
    chainId: 1,
    address: undefined,
    topics: [null, null, null, null],
    includeTransactionReceipts: false,
  });

  expect(logFilterFragments[0]!.id).toBe("1_null_null_null_null_null_0");
});

test("getLogFilterFragmentIds generates 1 log filter fragment for simple filter", () => {
  const logFilterFragments = getLogFilterFragmentIds({
    type: "log",
    chainId: 1,
    address: "0xa",
    topics: [null, null, null, null],
    includeTransactionReceipts: false,
  });

  expect(logFilterFragments[0]!.id).toBe("1_0xa_null_null_null_null_0");
});

test("getLogFilterFragmentIds generates 4 log filter fragment for 2x2 filter", () => {
  const logFilterFragments = getLogFilterFragmentIds({
    type: "log",
    chainId: 115511,
    address: ["0xa", "0xb"],
    topics: [["0xc", "0xd"], null, "0xe", null],
    includeTransactionReceipts: false,
  });

  expect(logFilterFragments[0]!.id).toBe("115511_0xa_0xc_null_0xe_null_0");
  expect(logFilterFragments[1]!.id).toBe("115511_0xa_0xd_null_0xe_null_0");
  expect(logFilterFragments[2]!.id).toBe("115511_0xb_0xc_null_0xe_null_0");
  expect(logFilterFragments[3]!.id).toBe("115511_0xb_0xd_null_0xe_null_0");
});

test("getLogFilterFragmentIds generates 12 log filter fragment for 2x2x3 filter", () => {
  const logFilterFragments = getLogFilterFragmentIds({
    type: "log",
    chainId: 1,
    address: ["0xa", "0xb"],
    topics: [["0xc", "0xd"], null, ["0xe", "0xf", "0x1"], null],
    includeTransactionReceipts: false,
  });

  expect(logFilterFragments.length).toBe(12);
});

test("getLogFilterFragmentIds includeTransactionReceipts", () => {
  const logFilterFragments = getLogFilterFragmentIds({
    type: "log",
    chainId: 1,
    address: undefined,
    topics: [null, null, null, null],
    includeTransactionReceipts: true,
  });

  expect(logFilterFragments[0]!.id).toBe("1_null_null_null_null_null_1");
});

test("getLogFilterFragmentIds builds id containing factory topic", () => {
  const factory = buildLogFactory({
    address: "0xa",
    event: llamaFactoryEventAbiItem,
    parameter: "deployer",
    chainId: 1,
  });

  const fragments = getLogFilterFragmentIds({
    type: "log",
    chainId: 1,
    topics: [null, null, null, null],
    address: factory,
    includeTransactionReceipts: false,
  });

  expect(fragments).toHaveLength(1);

  expect(fragments[0]!.id).toBe(
    "1_0xa_0x00fef2d461a2fabbb523f9f42752c61336f03b17a602af52cc6c83cb8b110599_topic1_null_null_null_null_0",
  );
});

test("getLogFilterFragmentIds builds id containing factory offset", () => {
  const factory = buildLogFactory({
    address: "0xa",
    event: llamaFactoryEventAbiItem,
    parameter: "llamaPolicy",
    chainId: 1,
  });

  const fragments = getLogFilterFragmentIds({
    type: "log",
    chainId: 115511,
    topics: [null, null, null, null],
    address: factory,
    includeTransactionReceipts: false,
  });

  expect(fragments).toHaveLength(1);

  expect(fragments[0]!.id).toBe(
    "115511_0xa_0x00fef2d461a2fabbb523f9f42752c61336f03b17a602af52cc6c83cb8b110599_offset64_null_null_null_null_0",
  );
});

test("getLogFilterFragmentIds builds id with multiple factories", () => {
  const factory = buildLogFactory({
    address: ["0xa", "0xb"],
    event: llamaFactoryEventAbiItem,
    parameter: "llamaPolicy",
    chainId: 1,
  });

  const fragments = getLogFilterFragmentIds({
    type: "log",
    chainId: 1,
    topics: [null, null, null, null],
    address: factory,
    includeTransactionReceipts: false,
  });

  expect(fragments).toHaveLength(2);

  expect(fragments[0]!.id).toBe(
    "1_0xa_0x00fef2d461a2fabbb523f9f42752c61336f03b17a602af52cc6c83cb8b110599_offset64_null_null_null_null_0",
  );
  expect(fragments[1]!.id).toBe(
    "1_0xb_0x00fef2d461a2fabbb523f9f42752c61336f03b17a602af52cc6c83cb8b110599_offset64_null_null_null_null_0",
  );
});
