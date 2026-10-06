import {
  encodeEventTopics,
  type Hex,
  padHex,
  parseEther,
  toHex,
  zeroAddress,
} from "viem";
import { encodeFunctionData, encodeFunctionResult } from "viem/utils";
import { beforeEach, expect, test } from "vitest";
import { ALICE, BOB } from "@/_test/constants.js";
import { erc20ABI } from "@/_test/generated.js";
import { context, setupCommon } from "@/_test/setup.js";
import {
  getAccountsIndexingBuild,
  getBlocksIndexingBuild,
  getChain,
  getErc20IndexingBuild,
} from "@/_test/utils.js";
import type {
  BlockEvent,
  Event,
  InternalBlock,
  InternalTrace,
  InternalTransaction,
  InternalTransactionReceipt,
  LogEvent,
  RawEvent,
  TraceEvent,
  TransferEvent,
} from "@/internal/types.js";
import {
  decodeCheckpoint,
  ZERO_CHECKPOINT_STRING,
} from "@/utils/checkpoint.js";
import { buildEvents, decodeEvents, splitEvents } from "./events.js";

beforeEach(setupCommon);

test("splitEvents()", async () => {
  const events = [
    {
      chain: { id: 1 },
      checkpoint: "0",
      event: {
        block: {
          hash: "0x1",
          timestamp: 1,
          number: 1n,
        },
      },
    },
    {
      chain: { id: 1 },
      checkpoint: "0",
      event: {
        block: {
          hash: "0x2",
          timestamp: 2,
          number: 2n,
        },
      },
    },
  ] as unknown as Event[];

  const result = splitEvents(events);

  expect(result).toMatchInlineSnapshot(`
    [
      {
        "chainId": 1,
        "checkpoint": "000000000100000000000000010000000000000001999999999999999999999999999999999",
        "events": [
          {
            "chain": {
              "id": 1,
            },
            "checkpoint": "0",
            "event": {
              "block": {
                "hash": "0x1",
                "number": 1n,
                "timestamp": 1,
              },
            },
          },
        ],
      },
      {
        "chainId": 1,
        "checkpoint": "000000000200000000000000010000000000000002999999999999999999999999999999999",
        "events": [
          {
            "chain": {
              "id": 1,
            },
            "checkpoint": "0",
            "event": {
              "block": {
                "hash": "0x2",
                "number": 2n,
                "timestamp": 2,
              },
            },
          },
        ],
      },
    ]
  `);
});

test("decodeEvents() log", async () => {
  const { common } = context;

  const { eventCallbacks } = getErc20IndexingBuild({
    address: zeroAddress,
  });

  const topics = encodeEventTopics({
    abi: erc20ABI,
    eventName: "Transfer",
    args: {
      from: zeroAddress,
      to: ALICE,
    },
  });

  const data = padHex(toHex(parseEther("1")), { size: 32 });

  const rawEvent = {
    chainId: 1,
    eventCallbackIndex: 0,
    checkpoint: ZERO_CHECKPOINT_STRING,
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: { data, topics },
  } as RawEvent;

  const events = decodeEvents(common, getChain(), eventCallbacks, [
    rawEvent,
  ]) as [LogEvent];

  expect(events).toHaveLength(1);
  expect(events[0].event.args).toMatchObject({
    from: zeroAddress,
    to: ALICE.toLowerCase(),
    amount: parseEther("1"),
  });
});

test("decodeEvents() log error", async () => {
  const { common } = context;

  const { eventCallbacks } = getErc20IndexingBuild({
    address: zeroAddress,
  });

  const topics = encodeEventTopics({
    abi: erc20ABI,
    eventName: "Transfer",
    args: {
      from: zeroAddress,
      to: ALICE,
    },
  });

  // invalid log.data, causing an error when decoding
  const rawEvent = {
    chainId: 1,
    eventCallbackIndex: 0,
    checkpoint: ZERO_CHECKPOINT_STRING,
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: {
      data: "0x0" as Hex,
      topics,
    },
  } as RawEvent;

  const events = decodeEvents(common, getChain(), eventCallbacks, [
    rawEvent,
  ]) as [LogEvent];

  expect(events).toHaveLength(0);
});

test("decodeEvents() block", async () => {
  const { common } = context;

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  const rawEvent = {
    chainId: 1,
    eventCallbackIndex: 0,
    checkpoint: ZERO_CHECKPOINT_STRING,
    block: {
      number: 1n,
    } as RawEvent["block"],
    transaction: undefined,
    log: undefined,
  } as RawEvent;

  const events = decodeEvents(common, getChain(), eventCallbacks, [
    rawEvent,
  ]) as [BlockEvent];

  expect(events).toHaveLength(1);
  expect(events[0].event.block).toMatchObject({
    number: 1n,
  });
});

test("decodeEvents() transfer", async () => {
  const { common } = context;

  const { eventCallbacks } = getAccountsIndexingBuild({
    address: ALICE,
  });

  const rawEvent = {
    chainId: 1,
    eventCallbackIndex: 3,
    checkpoint: ZERO_CHECKPOINT_STRING,
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: undefined,
    trace: {
      type: "CALL",
      from: ALICE,
      to: BOB,
      gas: 0n,
      gasUsed: 0n,
      input: "0x0",
      output: "0x0",
      value: parseEther("1"),
      traceAddress: [],
      blockNumber: 0,
      transactionIndex: 0,
    },
  } as RawEvent;

  const events = decodeEvents(common, getChain(), eventCallbacks, [
    rawEvent,
  ]) as [TransferEvent];

  expect(events).toHaveLength(1);
  expect(events[0].event.transfer).toMatchObject({
    from: ALICE,
    to: BOB,
    value: parseEther("1"),
  });
});

test("decodeEvents() transaction", async () => {
  const { common } = context;

  const { eventCallbacks } = getAccountsIndexingBuild({
    address: ALICE,
  });

  const rawEvent = {
    chainId: 1,
    eventCallbackIndex: 0,
    checkpoint: ZERO_CHECKPOINT_STRING,
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: undefined,
    trace: undefined,
  } as RawEvent;

  const events = decodeEvents(common, getChain(), eventCallbacks, [
    rawEvent,
  ]) as [TransferEvent];

  expect(events).toHaveLength(1);
});

test("decodeEvents() trace", async () => {
  const { common } = context;

  const { eventCallbacks } = getErc20IndexingBuild({
    address: zeroAddress,
    includeCallTraces: true,
  });

  const rawEvent = {
    chainId: 1,
    eventCallbackIndex: 0,
    checkpoint: ZERO_CHECKPOINT_STRING,
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: undefined,
    trace: {
      type: "CALL",
      from: ALICE,
      to: BOB,
      input: encodeFunctionData({
        abi: erc20ABI,
        functionName: "transfer",
        args: [BOB, parseEther("1")],
      }),
      output: encodeFunctionResult({
        abi: erc20ABI,
        functionName: "transfer",
        result: true,
      }),
      gas: 0n,
      gasUsed: 0n,
      value: 0n,
      traceAddress: [],
      blockNumber: 0,
      transactionIndex: 0,
    },
  } as RawEvent;

  const events = decodeEvents(common, getChain(), eventCallbacks, [
    rawEvent,
  ]) as [TraceEvent];

  expect(events).toHaveLength(1);
  expect(events[0].event.args).toStrictEqual([BOB, parseEther("1")]);
  expect(events[0].event.result).toBe(true);
});

test("decodeEvents() trace w/o output", async () => {
  const { common } = context;

  const { eventCallbacks } = getErc20IndexingBuild({
    address: zeroAddress,
    includeCallTraces: true,
  });

  // Remove output from the trace abi
  // Note: `abiItem` is shared with `erc20ABI`, so copy it instead of mutating it.
  // @ts-expect-error
  eventCallbacks[0].abiItem = { ...eventCallbacks[0].abiItem, outputs: [] };

  const rawEvent = {
    chainId: 1,
    eventCallbackIndex: 0,
    checkpoint: ZERO_CHECKPOINT_STRING,
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: undefined,
    trace: {
      type: "CALL",
      from: ALICE,
      to: BOB,
      input: encodeFunctionData({
        abi: erc20ABI,
        functionName: "transfer",
        args: [BOB, parseEther("1")],
      }),
      output: undefined,
      gas: 0n,
      gasUsed: 0n,
      value: 0n,
      traceAddress: [],
      blockNumber: 0,
      transactionIndex: 0,
    },
  } as RawEvent;

  const events = decodeEvents(common, getChain(), eventCallbacks, [
    rawEvent,
  ]) as [TraceEvent];

  expect(events).toHaveLength(1);
  expect(events[0].event.args).toStrictEqual([BOB, parseEther("1")]);
  expect(events[0].event.result).toBe(undefined);
});

test("decodeEvents() trace error", async () => {
  const { common } = context;

  const { eventCallbacks } = getErc20IndexingBuild({
    address: zeroAddress,
    includeCallTraces: true,
  });

  const rawEvent = {
    chainId: 1,
    eventCallbackIndex: 0,
    checkpoint: ZERO_CHECKPOINT_STRING,
    block: {} as RawEvent["block"],
    transaction: {} as RawEvent["transaction"],
    log: undefined,
    trace: {
      type: "CALL",
      from: ALICE,
      to: BOB,
      input: "0x",
      output: encodeFunctionResult({
        abi: erc20ABI,
        functionName: "transfer",
        result: true,
      }),
      gas: 0n,
      gasUsed: 0n,
      value: 0n,
      traceAddress: [],
      blockNumber: 0,
      transactionIndex: 0,
    },
  } as RawEvent;

  const events = decodeEvents(common, getChain(), eventCallbacks, [
    rawEvent,
  ]) as [TraceEvent];

  expect(events).toHaveLength(0);
});

test("buildEvents() transaction matches receipt by transaction index", async () => {
  const { eventCallbacks } = getAccountsIndexingBuild({ address: ALICE });

  const block = {
    number: 1n,
    timestamp: 1n,
    hash: toHex(1, { size: 32 }),
  } as InternalBlock;
  const transaction = (transactionIndex: number) =>
    ({
      blockNumber: 1,
      transactionIndex,
      hash: toHex(transactionIndex, { size: 32 }),
      from: BOB,
      to: ALICE.toLowerCase(),
      type: "legacy",
    }) as InternalTransaction;
  const receipt = (
    transactionIndex: number,
    status: InternalTransactionReceipt["status"],
  ) =>
    ({
      blockNumber: 1,
      transactionIndex,
      from: BOB,
      to: ALICE.toLowerCase(),
      status,
    }) as InternalTransactionReceipt;

  const build = (transactionReceipts: InternalTransactionReceipt[]) =>
    buildEvents({
      eventCallbacks,
      blocks: [block],
      logs: [],
      transactions: [transaction(0), transaction(1)],
      transactionReceipts,
      traces: [],
      childAddresses: new Map(),
      chainId: 1,
    });

  const receipts = [receipt(0, "reverted"), receipt(1, "success")];
  const events = build(receipts);
  expect(events).toHaveLength(1);
  expect(events[0]!.transaction!.transactionIndex).toBe(1);
  expect(events[0]!.transactionReceipt).toBe(receipts[1]);

  expect(() => build([receipt(1, "success")])).toThrow(
    "Missing transaction receipt for block 1 and transaction index 0",
  );
  expect(() => build([receipt(0, "success")])).toThrow(
    "Missing transaction receipt for block 1 and transaction index 1",
  );
});

test("buildEvents() trace index ignores traces that match no filter", async () => {
  const erc20 = "0x1111111111111111111111111111111111111111";
  const alice = ALICE.toLowerCase() as `0x${string}`;
  const bob = BOB.toLowerCase() as `0x${string}`;

  const eventCallbacks = [
    ...getErc20IndexingBuild({ address: erc20, includeCallTraces: true })
      .eventCallbacks,
    ...getAccountsIndexingBuild({ address: ALICE }).eventCallbacks.filter(
      ({ filter }) => filter.type === "transfer",
    ),
  ];

  const block = {
    number: 1n,
    timestamp: 1n,
    hash: toHex(1, { size: 32 }),
  } as InternalBlock;
  const transactions = [
    {
      blockNumber: 1,
      transactionIndex: 0,
      hash: toHex(0, { size: 32 }),
      from: alice,
      to: erc20,
      type: "legacy",
    },
    {
      blockNumber: 1,
      transactionIndex: 1,
      hash: toHex(1, { size: 32 }),
      from: alice,
      to: erc20,
      type: "legacy",
    },
  ] as InternalTransaction[];

  const transferInput = encodeFunctionData({
    abi: erc20ABI,
    functionName: "transfer",
    args: [BOB, parseEther("1")],
  });

  // Matched by the ERC20 call trace filter
  const call0: InternalTrace = {
    type: "CALL",
    from: alice,
    to: erc20,
    input: transferInput,
    output: undefined,
    value: 0n,
    gas: 0n,
    gasUsed: 0n,
    traceAddress: [],
    blockNumber: 1,
    transactionIndex: 0,
  };
  // Matched by the `transfer:from` filter
  const transfer0: InternalTrace = {
    type: "CALL",
    from: alice,
    to: bob,
    input: "0x",
    output: undefined,
    value: parseEther("1"),
    gas: 0n,
    gasUsed: 0n,
    traceAddress: [3],
    blockNumber: 1,
    transactionIndex: 0,
  };
  // Matched by the ERC20 call trace filter
  const call1: InternalTrace = {
    ...call0,
    transactionIndex: 1,
  };

  const exact = buildEvents({
    eventCallbacks,
    blocks: [block],
    logs: [],
    transactions,
    transactionReceipts: [],
    traces: [call0, transfer0, call1],
    childAddresses: new Map(),
    chainId: 1,
  });
  const superset = buildEvents({
    eventCallbacks,
    blocks: [block],
    logs: [],
    transactions,
    transactionReceipts: [],
    traces: [
      call0,
      // `STATICCALL` frame with a selector of the ERC20 ABI
      {
        ...call0,
        type: "STATICCALL",
        from: erc20,
        input: encodeFunctionData({
          abi: erc20ABI,
          functionName: "balanceOf",
          args: [BOB],
        }),
        value: null,
        traceAddress: [0],
      },
      // `CALL` frame without value
      { ...transfer0, value: 0n, traceAddress: [1] },
      // `DELEGATECALL` frame that reports the value of its parent call
      { ...transfer0, type: "DELEGATECALL", traceAddress: [2] },
      transfer0,
      call1,
    ],
    childAddresses: new Map(),
    chainId: 1,
  });

  expect(exact.map((event) => event.trace!.traceAddress)).toStrictEqual([
    [],
    [3],
    [],
  ]);
  expect(superset.map((event) => event.checkpoint)).toStrictEqual(
    exact.map((event) => event.checkpoint),
  );
  expect(
    exact.map((event) => decodeCheckpoint(event.checkpoint).eventIndex),
  ).toStrictEqual([0n, 1n, 0n]);
});
