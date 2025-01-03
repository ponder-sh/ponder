import { buildLogFactory } from "@/build/factory.js";
import { parseAbiItem } from "viem";
import { expect, test } from "vitest";
import { getLogFilterFragments } from "./fragments.js";

const llamaFactoryEventAbiItem = parseAbiItem(
  "event LlamaInstanceCreated(address indexed deployer, string indexed name, address llamaCore, address llamaExecutor, address llamaPolicy, uint256 chainId)",
);

test("getLogFilterFragments generates 1 log filter fragment for null filter", () => {
  const logFilterFragments = getLogFilterFragments({
    type: "log",
    chainId: 1,
    address: undefined,
    topic0: null,
    topic1: null,
    topic2: null,
    topic3: null,
    include: [],
  });

  expect(logFilterFragments).toMatchInlineSnapshot(`
    [
      {
        "adjacentIds": [
          "log_1_null_null_null_null_null_0",
          "log_1_null_null_null_null_null_1",
        ],
        "fragment": {
          "address": null,
          "chainId": 1,
          "includeTransactionReceipts": false,
          "topic0": null,
          "topic1": null,
          "topic2": null,
          "topic3": null,
          "type": "log",
        },
      },
    ]
  `);
});

test("getLogFilterFragments generates 1 log filter fragment for simple filter", () => {
  const logFilterFragments = getLogFilterFragments({
    type: "log",
    chainId: 1,
    address: "0xa",
    topic0: null,
    topic1: null,
    topic2: null,
    topic3: null,
    include: [],
  });

  expect(logFilterFragments).toMatchInlineSnapshot(`
    [
      {
        "adjacentIds": [
          "log_1_0xa_null_null_null_null_0",
          "log_1_0xa_null_null_null_null_1",
          "log_1_null_null_null_null_null_0",
          "log_1_null_null_null_null_null_1",
        ],
        "fragment": {
          "address": "0xa",
          "chainId": 1,
          "includeTransactionReceipts": false,
          "topic0": null,
          "topic1": null,
          "topic2": null,
          "topic3": null,
          "type": "log",
        },
      },
    ]
  `);
});

test("getLogFilterFragments generates 4 log filter fragment for 2x2 filter", () => {
  const logFilterFragments = getLogFilterFragments({
    type: "log",
    chainId: 115511,
    address: ["0xa", "0xb"],
    topic0: ["0xc", "0xd"],
    topic1: null,
    topic2: "0xe",
    topic3: null,
    include: [],
  });

  expect(logFilterFragments).toMatchInlineSnapshot(`
    [
      {
        "adjacentIds": [
          "log_115511_0xa_0xc_null_0xe_null_0",
          "log_115511_0xa_0xc_null_0xe_null_1",
          "log_115511_0xa_0xc_null_null_null_0",
          "log_115511_0xa_0xc_null_null_null_1",
          "log_115511_0xa_null_null_0xe_null_0",
          "log_115511_0xa_null_null_0xe_null_1",
          "log_115511_0xa_null_null_null_null_0",
          "log_115511_0xa_null_null_null_null_1",
          "log_115511_null_0xc_null_0xe_null_0",
          "log_115511_null_0xc_null_0xe_null_1",
          "log_115511_null_0xc_null_null_null_0",
          "log_115511_null_0xc_null_null_null_1",
          "log_115511_null_null_null_0xe_null_0",
          "log_115511_null_null_null_0xe_null_1",
          "log_115511_null_null_null_null_null_0",
          "log_115511_null_null_null_null_null_1",
        ],
        "fragment": {
          "address": "0xa",
          "chainId": 115511,
          "includeTransactionReceipts": false,
          "topic0": "0xc",
          "topic1": null,
          "topic2": "0xe",
          "topic3": null,
          "type": "log",
        },
      },
      {
        "adjacentIds": [
          "log_115511_0xa_0xd_null_0xe_null_0",
          "log_115511_0xa_0xd_null_0xe_null_1",
          "log_115511_0xa_0xd_null_null_null_0",
          "log_115511_0xa_0xd_null_null_null_1",
          "log_115511_0xa_null_null_0xe_null_0",
          "log_115511_0xa_null_null_0xe_null_1",
          "log_115511_0xa_null_null_null_null_0",
          "log_115511_0xa_null_null_null_null_1",
          "log_115511_null_0xd_null_0xe_null_0",
          "log_115511_null_0xd_null_0xe_null_1",
          "log_115511_null_0xd_null_null_null_0",
          "log_115511_null_0xd_null_null_null_1",
          "log_115511_null_null_null_0xe_null_0",
          "log_115511_null_null_null_0xe_null_1",
          "log_115511_null_null_null_null_null_0",
          "log_115511_null_null_null_null_null_1",
        ],
        "fragment": {
          "address": "0xa",
          "chainId": 115511,
          "includeTransactionReceipts": false,
          "topic0": "0xd",
          "topic1": null,
          "topic2": "0xe",
          "topic3": null,
          "type": "log",
        },
      },
      {
        "adjacentIds": [
          "log_115511_0xb_0xc_null_0xe_null_0",
          "log_115511_0xb_0xc_null_0xe_null_1",
          "log_115511_0xb_0xc_null_null_null_0",
          "log_115511_0xb_0xc_null_null_null_1",
          "log_115511_0xb_null_null_0xe_null_0",
          "log_115511_0xb_null_null_0xe_null_1",
          "log_115511_0xb_null_null_null_null_0",
          "log_115511_0xb_null_null_null_null_1",
          "log_115511_null_0xc_null_0xe_null_0",
          "log_115511_null_0xc_null_0xe_null_1",
          "log_115511_null_0xc_null_null_null_0",
          "log_115511_null_0xc_null_null_null_1",
          "log_115511_null_null_null_0xe_null_0",
          "log_115511_null_null_null_0xe_null_1",
          "log_115511_null_null_null_null_null_0",
          "log_115511_null_null_null_null_null_1",
        ],
        "fragment": {
          "address": "0xb",
          "chainId": 115511,
          "includeTransactionReceipts": false,
          "topic0": "0xc",
          "topic1": null,
          "topic2": "0xe",
          "topic3": null,
          "type": "log",
        },
      },
      {
        "adjacentIds": [
          "log_115511_0xb_0xd_null_0xe_null_0",
          "log_115511_0xb_0xd_null_0xe_null_1",
          "log_115511_0xb_0xd_null_null_null_0",
          "log_115511_0xb_0xd_null_null_null_1",
          "log_115511_0xb_null_null_0xe_null_0",
          "log_115511_0xb_null_null_0xe_null_1",
          "log_115511_0xb_null_null_null_null_0",
          "log_115511_0xb_null_null_null_null_1",
          "log_115511_null_0xd_null_0xe_null_0",
          "log_115511_null_0xd_null_0xe_null_1",
          "log_115511_null_0xd_null_null_null_0",
          "log_115511_null_0xd_null_null_null_1",
          "log_115511_null_null_null_0xe_null_0",
          "log_115511_null_null_null_0xe_null_1",
          "log_115511_null_null_null_null_null_0",
          "log_115511_null_null_null_null_null_1",
        ],
        "fragment": {
          "address": "0xb",
          "chainId": 115511,
          "includeTransactionReceipts": false,
          "topic0": "0xd",
          "topic1": null,
          "topic2": "0xe",
          "topic3": null,
          "type": "log",
        },
      },
    ]
  `);
});

test("getLogFilterFragments generates 12 log filter fragment for 2x2x3 filter", () => {
  const logFilterFragments = getLogFilterFragments({
    type: "log",
    chainId: 1,
    address: ["0xa", "0xb"],
    topic0: ["0xc", "0xd"],
    topic1: null,
    topic2: ["0xe", "0xf", "0x1"],
    topic3: null,
    include: [],
  });

  expect(logFilterFragments.length).toBe(12);
});

test("getLogFilterFragments includeTransactionReceipts", () => {
  const logFilterFragments = getLogFilterFragments({
    type: "log",
    chainId: 1,
    address: undefined,
    topic0: null,
    topic1: null,
    topic2: null,
    topic3: null,
    include: ["transactionReceipt.status"],
  });

  expect(logFilterFragments).toMatchInlineSnapshot(`
    [
      {
        "adjacentIds": [
          "log_1_null_null_null_null_null_1",
        ],
        "fragment": {
          "address": null,
          "chainId": 1,
          "includeTransactionReceipts": true,
          "topic0": null,
          "topic1": null,
          "topic2": null,
          "topic3": null,
          "type": "log",
        },
      },
    ]
  `);
});

test("getLogFilterFragments builds id containing factory topic", () => {
  const factory = buildLogFactory({
    address: "0xa",
    event: llamaFactoryEventAbiItem,
    parameter: "deployer",
    chainId: 1,
  });

  const fragments = getLogFilterFragments({
    type: "log",
    chainId: 1,
    topic0: null,
    topic1: null,
    topic2: null,
    topic3: null,
    address: factory,
    include: [],
  });

  expect(fragments).toMatchInlineSnapshot(`
    [
      {
        "adjacentIds": [
          "log_1_0xa_0x00fef2d461a2fabbb523f9f42752c61336f03b17a602af52cc6c83cb8b110599_topic1_null_null_null_null_0",
          "log_1_0xa_0x00fef2d461a2fabbb523f9f42752c61336f03b17a602af52cc6c83cb8b110599_topic1_null_null_null_null_1",
        ],
        "fragment": {
          "address": {
            "address": "0xa",
            "childAddressLocation": "topic1",
            "eventSelector": "0x00fef2d461a2fabbb523f9f42752c61336f03b17a602af52cc6c83cb8b110599",
          },
          "chainId": 1,
          "includeTransactionReceipts": false,
          "topic0": null,
          "topic1": null,
          "topic2": null,
          "topic3": null,
          "type": "log",
        },
      },
    ]
  `);
});

test("getLogFilterFragments builds id containing factory offset", () => {
  const factory = buildLogFactory({
    address: "0xa",
    event: llamaFactoryEventAbiItem,
    parameter: "llamaPolicy",
    chainId: 1,
  });

  const fragments = getLogFilterFragments({
    type: "log",
    chainId: 115511,
    topic0: null,
    topic1: null,
    topic2: null,
    topic3: null,
    address: factory,
    include: [],
  });

  expect(fragments).toMatchInlineSnapshot(`
    [
      {
        "adjacentIds": [
          "log_115511_0xa_0x00fef2d461a2fabbb523f9f42752c61336f03b17a602af52cc6c83cb8b110599_offset64_null_null_null_null_0",
          "log_115511_0xa_0x00fef2d461a2fabbb523f9f42752c61336f03b17a602af52cc6c83cb8b110599_offset64_null_null_null_null_1",
        ],
        "fragment": {
          "address": {
            "address": "0xa",
            "childAddressLocation": "offset64",
            "eventSelector": "0x00fef2d461a2fabbb523f9f42752c61336f03b17a602af52cc6c83cb8b110599",
          },
          "chainId": 115511,
          "includeTransactionReceipts": false,
          "topic0": null,
          "topic1": null,
          "topic2": null,
          "topic3": null,
          "type": "log",
        },
      },
    ]
  `);
});

test("getLogFilterFragments builds id with multiple factories", () => {
  const factory = buildLogFactory({
    address: ["0xa", "0xb"],
    event: llamaFactoryEventAbiItem,
    parameter: "llamaPolicy",
    chainId: 1,
  });

  const fragments = getLogFilterFragments({
    type: "log",
    chainId: 1,
    topic0: null,
    topic1: null,
    topic2: null,
    topic3: null,
    address: factory,
    include: [],
  });

  expect(fragments).toMatchInlineSnapshot(`
    [
      {
        "adjacentIds": [
          "log_1_0xa_0x00fef2d461a2fabbb523f9f42752c61336f03b17a602af52cc6c83cb8b110599_offset64_null_null_null_null_0",
          "log_1_0xa_0x00fef2d461a2fabbb523f9f42752c61336f03b17a602af52cc6c83cb8b110599_offset64_null_null_null_null_1",
        ],
        "fragment": {
          "address": {
            "address": "0xa",
            "childAddressLocation": "offset64",
            "eventSelector": "0x00fef2d461a2fabbb523f9f42752c61336f03b17a602af52cc6c83cb8b110599",
          },
          "chainId": 1,
          "includeTransactionReceipts": false,
          "topic0": null,
          "topic1": null,
          "topic2": null,
          "topic3": null,
          "type": "log",
        },
      },
      {
        "adjacentIds": [
          "log_1_0xb_0x00fef2d461a2fabbb523f9f42752c61336f03b17a602af52cc6c83cb8b110599_offset64_null_null_null_null_0",
          "log_1_0xb_0x00fef2d461a2fabbb523f9f42752c61336f03b17a602af52cc6c83cb8b110599_offset64_null_null_null_null_1",
        ],
        "fragment": {
          "address": {
            "address": "0xb",
            "childAddressLocation": "offset64",
            "eventSelector": "0x00fef2d461a2fabbb523f9f42752c61336f03b17a602af52cc6c83cb8b110599",
          },
          "chainId": 1,
          "includeTransactionReceipts": false,
          "topic0": null,
          "topic1": null,
          "topic2": null,
          "topic3": null,
          "type": "log",
        },
      },
    ]
  `);
});
