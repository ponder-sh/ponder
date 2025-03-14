import type { FilterWithoutBlocks } from "@/internal/types.js";
import { expect, test } from "vitest";
import {
  decodeFragment,
  encodeFragment,
  getFragments,
  recoverFilter,
} from "./fragments.js";

test("getFragments() block filter", () => {
  const fragments = getFragments({
    type: "block",
    chainId: 1,
    interval: 100,
    offset: 5,
    include: [],
  });

  expect(fragments).toMatchInlineSnapshot(`
    [
      {
        "adjacentIds": [
          "block_1_100_5",
        ],
        "fragment": {
          "chainId": 1,
          "interval": 100,
          "offset": 5,
          "type": "block",
        },
      },
    ]
  `);
});

test("getFragments() transaction filter", () => {
  const fragments = getFragments({
    type: "transaction",
    chainId: 1,
    fromAddress: "0xa",
    toAddress: "0xb",
    includeReverted: false,
    include: [],
  });

  expect(fragments).toMatchInlineSnapshot(`
    [
      {
        "adjacentIds": [
          "transaction_1_0xa_0xb",
          "transaction_1_0xa_null",
          "transaction_1_null_0xb",
          "transaction_1_null_null",
        ],
        "fragment": {
          "chainId": 1,
          "fromAddress": "0xa",
          "toAddress": "0xb",
          "type": "transaction",
        },
      },
    ]
  `);
});

test("getFragments() log filter", () => {
  const fragments = getFragments({
    type: "log",
    chainId: 1,
    address: ["0xa", "0xb"],
    topic0: ["0xc", "0xd"],
    topic1: null,
    topic2: "0xe",
    topic3: null,
    include: [],
  });

  expect(fragments).toMatchInlineSnapshot(`
    [
      {
        "adjacentIds": [
          "log_1_0xa_0xc_null_0xe_null_0",
          "log_1_0xa_0xc_null_0xe_null_1",
          "log_1_0xa_0xc_null_null_null_0",
          "log_1_0xa_0xc_null_null_null_1",
          "log_1_0xa_null_null_0xe_null_0",
          "log_1_0xa_null_null_0xe_null_1",
          "log_1_0xa_null_null_null_null_0",
          "log_1_0xa_null_null_null_null_1",
          "log_1_null_0xc_null_0xe_null_0",
          "log_1_null_0xc_null_0xe_null_1",
          "log_1_null_0xc_null_null_null_0",
          "log_1_null_0xc_null_null_null_1",
          "log_1_null_null_null_0xe_null_0",
          "log_1_null_null_null_0xe_null_1",
          "log_1_null_null_null_null_null_0",
          "log_1_null_null_null_null_null_1",
        ],
        "fragment": {
          "address": "0xa",
          "chainId": 1,
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
          "log_1_0xa_0xd_null_0xe_null_0",
          "log_1_0xa_0xd_null_0xe_null_1",
          "log_1_0xa_0xd_null_null_null_0",
          "log_1_0xa_0xd_null_null_null_1",
          "log_1_0xa_null_null_0xe_null_0",
          "log_1_0xa_null_null_0xe_null_1",
          "log_1_0xa_null_null_null_null_0",
          "log_1_0xa_null_null_null_null_1",
          "log_1_null_0xd_null_0xe_null_0",
          "log_1_null_0xd_null_0xe_null_1",
          "log_1_null_0xd_null_null_null_0",
          "log_1_null_0xd_null_null_null_1",
          "log_1_null_null_null_0xe_null_0",
          "log_1_null_null_null_0xe_null_1",
          "log_1_null_null_null_null_null_0",
          "log_1_null_null_null_null_null_1",
        ],
        "fragment": {
          "address": "0xa",
          "chainId": 1,
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
          "log_1_0xb_0xc_null_0xe_null_0",
          "log_1_0xb_0xc_null_0xe_null_1",
          "log_1_0xb_0xc_null_null_null_0",
          "log_1_0xb_0xc_null_null_null_1",
          "log_1_0xb_null_null_0xe_null_0",
          "log_1_0xb_null_null_0xe_null_1",
          "log_1_0xb_null_null_null_null_0",
          "log_1_0xb_null_null_null_null_1",
          "log_1_null_0xc_null_0xe_null_0",
          "log_1_null_0xc_null_0xe_null_1",
          "log_1_null_0xc_null_null_null_0",
          "log_1_null_0xc_null_null_null_1",
          "log_1_null_null_null_0xe_null_0",
          "log_1_null_null_null_0xe_null_1",
          "log_1_null_null_null_null_null_0",
          "log_1_null_null_null_null_null_1",
        ],
        "fragment": {
          "address": "0xb",
          "chainId": 1,
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
          "log_1_0xb_0xd_null_0xe_null_0",
          "log_1_0xb_0xd_null_0xe_null_1",
          "log_1_0xb_0xd_null_null_null_0",
          "log_1_0xb_0xd_null_null_null_1",
          "log_1_0xb_null_null_0xe_null_0",
          "log_1_0xb_null_null_0xe_null_1",
          "log_1_0xb_null_null_null_null_0",
          "log_1_0xb_null_null_null_null_1",
          "log_1_null_0xd_null_0xe_null_0",
          "log_1_null_0xd_null_0xe_null_1",
          "log_1_null_0xd_null_null_null_0",
          "log_1_null_0xd_null_null_null_1",
          "log_1_null_null_null_0xe_null_0",
          "log_1_null_null_null_0xe_null_1",
          "log_1_null_null_null_null_null_0",
          "log_1_null_null_null_null_null_1",
        ],
        "fragment": {
          "address": "0xb",
          "chainId": 1,
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

test("getFragments() log filter with transaction receipts", () => {
  const fragments = getFragments({
    type: "log",
    chainId: 1,
    address: undefined,
    topic0: null,
    topic1: null,
    topic2: null,
    topic3: null,
    include: ["transactionReceipt.status"],
  });

  expect(fragments).toMatchInlineSnapshot(`
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

test("getFragments() trace filter", () => {
  const fragments = getFragments({
    type: "trace",
    chainId: 1,
    fromAddress: "0xa",
    toAddress: undefined,
    includeReverted: false,
    functionSelector: "0xb",
    callType: "CALL",
    include: [],
  });

  expect(fragments).toMatchInlineSnapshot(`
    [
      {
        "adjacentIds": [
          "trace_1_0xa_null_0xb_0",
          "trace_1_0xa_null_0xb_1",
          "trace_1_0xa_null_null_0",
          "trace_1_0xa_null_null_1",
          "trace_1_null_null_0xb_0",
          "trace_1_null_null_0xb_1",
          "trace_1_null_null_null_0",
          "trace_1_null_null_null_1",
        ],
        "fragment": {
          "chainId": 1,
          "fromAddress": "0xa",
          "functionSelector": "0xb",
          "includeTransactionReceipts": false,
          "toAddress": null,
          "type": "trace",
        },
      },
    ]
  `);
});

test("getFragments() transfer filter", () => {
  const fragments = getFragments({
    type: "transfer",
    chainId: 1,
    fromAddress: "0xa",
    toAddress: undefined,
    includeReverted: false,
    include: [],
  });

  expect(fragments).toMatchInlineSnapshot(`
    [
      {
        "adjacentIds": [
          "transfer_1_0xa_null_0",
          "transfer_1_0xa_null_1",
          "transfer_1_null_null_0",
          "transfer_1_null_null_1",
        ],
        "fragment": {
          "chainId": 1,
          "fromAddress": "0xa",
          "includeTransactionReceipts": false,
          "toAddress": null,
          "type": "transfer",
        },
      },
    ]
  `);
});

test("getFragments() factory with topic", () => {
  const fragments = getFragments({
    type: "log",
    chainId: 1,
    topic0: null,
    topic1: null,
    topic2: null,
    topic3: null,
    address: {
      type: "log",
      chainId: 1,
      address: "0xa",
      eventSelector: "0xb",
      childAddressLocation: "topic1",
      fromBlock: undefined,
      toBlock: undefined,
    },
    include: [],
  });

  expect(fragments).toMatchInlineSnapshot(`
    [
      {
        "adjacentIds": [
          "log_1_0xa_0xb_topic1_null_null_null_null_0",
          "log_1_0xa_0xb_topic1_null_null_null_null_1",
        ],
        "fragment": {
          "address": {
            "address": "0xa",
            "childAddressLocation": "topic1",
            "eventSelector": "0xb",
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

test("getFragments() factory with offset", () => {
  const fragments = getFragments({
    type: "log",
    chainId: 1,
    topic0: null,
    topic1: null,
    topic2: null,
    topic3: null,
    address: {
      type: "log",
      chainId: 1,
      address: "0xa",
      eventSelector: "0xb",
      childAddressLocation: "offset64",
      fromBlock: undefined,
      toBlock: undefined,
    },
    include: [],
  });

  expect(fragments).toMatchInlineSnapshot(`
    [
      {
        "adjacentIds": [
          "log_1_0xa_0xb_offset64_null_null_null_null_0",
          "log_1_0xa_0xb_offset64_null_null_null_null_1",
        ],
        "fragment": {
          "address": {
            "address": "0xa",
            "childAddressLocation": "offset64",
            "eventSelector": "0xb",
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

test("getFragments() multiple factories", () => {
  const fragments = getFragments({
    type: "log",
    chainId: 1,
    topic0: null,
    topic1: null,
    topic2: null,
    topic3: null,
    address: {
      type: "log",
      chainId: 1,
      address: ["0xa", "0xb"],
      eventSelector: "0xc",
      childAddressLocation: "topic1",
      fromBlock: undefined,
      toBlock: undefined,
    },
    include: [],
  });

  expect(fragments).toMatchInlineSnapshot(`
    [
      {
        "adjacentIds": [
          "log_1_0xa_0xc_topic1_null_null_null_null_0",
          "log_1_0xa_0xc_topic1_null_null_null_null_1",
        ],
        "fragment": {
          "address": {
            "address": "0xa",
            "childAddressLocation": "topic1",
            "eventSelector": "0xc",
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
          "log_1_0xb_0xc_topic1_null_null_null_null_0",
          "log_1_0xb_0xc_topic1_null_null_null_null_1",
        ],
        "fragment": {
          "address": {
            "address": "0xb",
            "childAddressLocation": "topic1",
            "eventSelector": "0xc",
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

test("decodeFragment()", () => {
  const [blockFragment] = getFragments({
    type: "block",
    chainId: 1,
    interval: 100,
    offset: 5,
    include: [],
  });

  expect(decodeFragment(encodeFragment(blockFragment!.fragment))).toStrictEqual(
    blockFragment!.fragment,
  );

  const [logFragment] = getFragments({
    type: "log",
    chainId: 1,
    address: ["0xa", "0xb"],
    topic0: ["0xc", "0xd"],
    topic1: null,
    topic2: "0xe",
    topic3: null,
    include: [],
  });

  expect(decodeFragment(encodeFragment(logFragment!.fragment))).toStrictEqual(
    logFragment!.fragment,
  );

  const [traceFragment] = getFragments({
    type: "trace",
    chainId: 1,
    fromAddress: {
      type: "log",
      chainId: 1,
      address: "0xa",
      eventSelector: "0xc",
      childAddressLocation: "topic1",
      fromBlock: undefined,
      toBlock: undefined,
    },
    toAddress: "0xb",
    includeReverted: false,
    functionSelector: "0xd",
    callType: "CALL",
    include: [],
  });

  expect(decodeFragment(encodeFragment(traceFragment!.fragment))).toStrictEqual(
    traceFragment!.fragment,
  );

  const [transferFragment] = getFragments({
    type: "transfer",
    chainId: 1,
    fromAddress: "0xa",
    toAddress: undefined,
    includeReverted: false,
    include: ["transactionReceipt.status"],
  });

  expect(
    decodeFragment(encodeFragment(transferFragment!.fragment)),
  ).toStrictEqual(transferFragment!.fragment);
});

test("recoverFilter() block filter", () => {
  const filter = {
    type: "block",
    chainId: 1,
    interval: 100,
    offset: 5,
    include: [],
  } satisfies FilterWithoutBlocks;

  const fragments = getFragments(filter);

  const recovered = recoverFilter(
    filter,
    fragments.map((f) => f.fragment),
  );

  expect(recovered).toStrictEqual(filter);
});

test("recoverFilter() transaction filter", () => {
  const filter = {
    type: "transaction",
    chainId: 1,
    fromAddress: "0xa",
    toAddress: "0xb",
    includeReverted: false,
    include: [],
  } satisfies FilterWithoutBlocks;

  const fragments = getFragments(filter);

  const recovered = recoverFilter(
    filter,
    fragments.map((f) => f.fragment),
  );

  expect(recovered).toStrictEqual(filter);
});

test("recoverFilter() log filter", () => {
  const filter = {
    type: "log",
    chainId: 1,
    address: ["0xa", "0xb"],
    topic0: ["0xc", "0xd"],
    topic1: null,
    topic2: "0xe",
    topic3: null,
    include: [],
  } satisfies FilterWithoutBlocks;

  const fragments = getFragments(filter);

  const recovered = recoverFilter(
    filter,
    fragments.map((f) => f.fragment),
  );

  expect(recovered).toStrictEqual(filter);
});

test("recoverFilter() trace filter", () => {
  const filter = {
    type: "trace",
    chainId: 1,
    fromAddress: "0xa",
    toAddress: undefined,
    includeReverted: false,
    functionSelector: "0xb",
    callType: "CALL",
    include: [],
  } satisfies FilterWithoutBlocks;

  const fragments = getFragments(filter);

  const recovered = recoverFilter(
    filter,
    fragments.map((f) => f.fragment),
  );

  expect(recovered).toStrictEqual(filter);
});

test("recoverFilter() transfer filter", () => {
  const filter = {
    type: "transfer",
    chainId: 1,
    fromAddress: "0xa",
    toAddress: undefined,
    includeReverted: false,
    include: [],
  } satisfies FilterWithoutBlocks;

  const fragments = getFragments(filter);

  const recovered = recoverFilter(
    filter,
    fragments.map((f) => f.fragment),
  );

  expect(recovered).toStrictEqual(filter);
});

test("recoverFilter() factory", () => {
  const filter = {
    type: "log",
    chainId: 1,
    topic0: null,
    topic1: null,
    topic2: null,
    topic3: null,
    address: {
      type: "log",
      chainId: 1,
      address: "0xa",
      eventSelector: "0xb",
      childAddressLocation: "topic1",
      fromBlock: undefined,
      toBlock: undefined,
    },
    include: [],
  } satisfies FilterWithoutBlocks;

  const fragments = getFragments(filter);

  const recovered = recoverFilter(
    filter,
    fragments.map((f) => f.fragment),
  );

  expect(recovered).toStrictEqual(filter);
});

test("recoverFilter() multiple factories", () => {
  const filter = {
    type: "log",
    chainId: 1,
    topic0: null,
    topic1: null,
    topic2: null,
    topic3: null,
    address: {
      type: "log",
      chainId: 1,
      address: ["0xa", "0xb"],
      eventSelector: "0xc",
      childAddressLocation: "topic1",
      fromBlock: undefined,
      toBlock: undefined,
    },
    include: [],
  } satisfies FilterWithoutBlocks;

  const fragments = getFragments(filter);

  const recovered = recoverFilter(
    filter,
    fragments.map((f) => f.fragment),
  );

  expect(recovered).toStrictEqual(filter);
});
