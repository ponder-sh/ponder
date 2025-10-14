import {
  EMPTY_BLOCK_FILTER,
  EMPTY_LOG_FILTER,
  EMPTY_TRACE_FILTER,
  EMPTY_TRANSACTION_FILTER,
  EMPTY_TRANSFER_FILTER,
} from "@/_test/constants.js";
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
    ...EMPTY_BLOCK_FILTER,
    interval: 100,
    offset: 5,
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
    ...EMPTY_TRANSACTION_FILTER,
    fromAddress: "0xa",
    toAddress: "0xb",
    includeReverted: false,
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
    ...EMPTY_LOG_FILTER,
    address: ["0xa", "0xb"],
    topic0: ["0xc", "0xd"],
    topic1: null,
    topic2: "0xe",
    topic3: null,
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
    ...EMPTY_LOG_FILTER,
    hasTransactionReceipt: true,
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
    ...EMPTY_TRACE_FILTER,
    fromAddress: "0xa",
    toAddress: undefined,
    includeReverted: false,
    functionSelector: "0xb",
    callType: "CALL",
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
    ...EMPTY_TRANSFER_FILTER,
    fromAddress: "0xa",
    toAddress: undefined,
    includeReverted: false,
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
    ...EMPTY_LOG_FILTER,
    address: {
      id: `log_${"0xa"}_${1}_topic${1}_${"0xb"}_${"undefined"}_${"undefined"}`,
      type: "log",
      chainId: 1,
      address: "0xa",
      eventSelector: "0xb",
      childAddressLocation: "topic1",
      fromBlock: undefined,
      toBlock: undefined,
    },
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
    ...EMPTY_LOG_FILTER,
    address: {
      id: `log_${"0xa"}_${1}_offset${64}_${"0xb"}_${"undefined"}_${"undefined"}`,
      type: "log",
      chainId: 1,
      address: "0xa",
      eventSelector: "0xb",
      childAddressLocation: "offset64",
      fromBlock: undefined,
      toBlock: undefined,
    },
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
    ...EMPTY_LOG_FILTER,
    address: {
      id: `log_${["0xa", "0xb"].join("_")}_${1}_topic${1}_${"0xb"}_${"undefined"}_${"undefined"}`,
      type: "log",
      chainId: 1,
      address: ["0xa", "0xb"],
      eventSelector: "0xc",
      childAddressLocation: "topic1",
      fromBlock: undefined,
      toBlock: undefined,
    },
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
    ...EMPTY_BLOCK_FILTER,
    interval: 100,
    offset: 5,
  });

  expect(decodeFragment(encodeFragment(blockFragment!.fragment))).toStrictEqual(
    blockFragment!.fragment,
  );

  const [logFragment] = getFragments({
    ...EMPTY_LOG_FILTER,
    chainId: 1,
    address: ["0xa", "0xb"],
    topic0: ["0xc", "0xd"],
    topic1: null,
    topic2: "0xe",
    topic3: null,
  });

  expect(decodeFragment(encodeFragment(logFragment!.fragment))).toStrictEqual(
    logFragment!.fragment,
  );

  const [traceFragment] = getFragments({
    ...EMPTY_TRACE_FILTER,
    fromAddress: {
      id: `log_${"0xa"}_${1}_topic${1}_${"0xc"}_${"undefined"}_${"undefined"}`,
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
  });

  expect(decodeFragment(encodeFragment(traceFragment!.fragment))).toStrictEqual(
    traceFragment!.fragment,
  );

  const [transferFragment] = getFragments({
    ...EMPTY_TRANSFER_FILTER,
    fromAddress: "0xa",
    toAddress: undefined,
    includeReverted: false,
  });

  expect(
    decodeFragment(encodeFragment(transferFragment!.fragment)),
  ).toStrictEqual(transferFragment!.fragment);
});

test("recoverFilter() block filter", () => {
  const filter = { ...EMPTY_BLOCK_FILTER, interval: 100, offset: 5 };

  const fragments = getFragments(filter);

  const recovered = recoverFilter(
    filter,
    fragments.map((f) => f.fragment),
  );

  expect(recovered).toStrictEqual(filter);
});

test("recoverFilter() transaction filter", () => {
  const filter = {
    ...EMPTY_TRANSACTION_FILTER,
    fromAddress: "0xa",
    toAddress: "0xb",
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
    ...EMPTY_LOG_FILTER,
    address: ["0xa", "0xb"],
    topic0: ["0xc", "0xd"],
    topic1: null,
    topic2: "0xe",
    topic3: null,
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
    ...EMPTY_TRACE_FILTER,
    callType: "CALL",
    functionSelector: "0xb",
    fromAddress: "0xa",
    toAddress: undefined,
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
    ...EMPTY_TRANSFER_FILTER,
    fromAddress: "0xa",
    toAddress: undefined,
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
    ...EMPTY_LOG_FILTER,
    address: {
      id: `log_${"0xa"}_${1}_topic${1}_${"0xb"}_${"undefined"}_${"undefined"}`,
      type: "log",
      chainId: 1,
      address: "0xa",
      eventSelector: "0xb",
      childAddressLocation: "topic1",
      fromBlock: undefined,
      toBlock: undefined,
    },
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
    ...EMPTY_LOG_FILTER,
    address: {
      id: `log_${["0xa", "0xb"].join("_")}_${1}_topic${1}_${"0xc"}_${"undefined"}_${"undefined"}`,
      type: "log",
      chainId: 1,
      address: ["0xa", "0xb"],
      eventSelector: "0xc",
      childAddressLocation: "topic1",
      fromBlock: undefined,
      toBlock: undefined,
    },
  } satisfies FilterWithoutBlocks;

  const fragments = getFragments(filter);

  const recovered = recoverFilter(
    filter,
    fragments.map((f) => f.fragment),
  );

  expect(recovered).toStrictEqual(filter);
});
