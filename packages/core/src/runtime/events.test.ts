import { ALICE, BOB } from "@/_test/constants.js";
import { setupAnvil, setupCommon } from "@/_test/setup.js";
import {
  deployErc20,
  mintErc20,
  transferErc20,
  transferEth,
} from "@/_test/simulate.js";
import {
  getAccountsIndexingBuild,
  getBlocksIndexingBuild,
  getChain,
  getErc20IndexingBuild,
} from "@/_test/utils.js";
import type {
  BlockEvent,
  Event,
  LogEvent,
  RawEvent,
  TraceEvent,
  TransferEvent,
} from "@/internal/types.js";
import { ZERO_CHECKPOINT_STRING } from "@/utils/checkpoint.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { parseEther, zeroAddress } from "viem";
import { beforeEach, expect, test } from "vitest";
import {
  decodeEvents,
  splitEvents,
  syncBlockToInternal,
  syncLogToInternal,
  syncTraceToInternal,
  syncTransactionReceiptToInternal,
  syncTransactionToInternal,
} from "./events.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);

test("splitEvents()", async () => {
  const events = [
    {
      chain: getChain(),
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
      chain: getChain(),
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

  for (const event of result) {
    for (const _event of event.events) {
      // @ts-ignore
      // biome-ignore lint/performance/noDelete: <explanation>
      delete _event.chain;
    }
  }

  expect(result).toMatchInlineSnapshot(`
    [
      {
        "chainId": 1,
        "checkpoint": "000000000100000000000000010000000000000001999999999999999999999999999999999",
        "events": [
          {
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

test("decodeEvents() log", async (context) => {
  const { common } = context;

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({
    address,
  });

  const events = decodeEvents(common, [
    {
      checkpoint: ZERO_CHECKPOINT_STRING,
      chain: getChain(),
      eventCallback: eventCallbacks[0],
      block: syncBlockToInternal({ block: blockData.block }),
      transaction: syncTransactionToInternal({
        transaction: blockData.transaction,
      }),
      log: syncLogToInternal({ log: blockData.log }),
    },
  ]) as [LogEvent];

  expect(events).toHaveLength(1);
  expect(events[0].event.args).toMatchObject({
    from: zeroAddress,
    to: ALICE.toLowerCase(),
    amount: parseEther("1"),
  });
});

test("decodeEvents() log error", async (context) => {
  const { common } = context;

  const { address } = await deployErc20({ sender: ALICE });
  const blockData = await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({
    address,
  });

  // invalid log.data, causing an error when decoding
  blockData.log.data = "0x0";

  const events = decodeEvents(common, [
    {
      checkpoint: ZERO_CHECKPOINT_STRING,
      chain: getChain(),
      eventCallback: eventCallbacks[0],
      block: syncBlockToInternal({ block: blockData.block }),
      transaction: syncTransactionToInternal({
        transaction: blockData.transaction,
      }),
      log: syncLogToInternal({ log: blockData.log }),
    },
  ]) as [LogEvent];

  expect(events).toHaveLength(0);
});

test("decodeEvents() block", async (context) => {
  const { common } = context;

  const { eventCallbacks } = getBlocksIndexingBuild({
    interval: 1,
  });

  const rawEvent = {
    chain: getChain(),
    checkpoint: ZERO_CHECKPOINT_STRING,
    eventCallback: eventCallbacks[0],
    block: {
      number: 1n,
    } as RawEvent["block"],
    transaction: undefined,
    log: undefined,
  } as RawEvent;

  const events = decodeEvents(common, [rawEvent]) as [BlockEvent];

  expect(events).toHaveLength(1);
  expect(events[0].event.block).toMatchObject({
    number: 1n,
  });
});

test("decodeEvents() transfer", async (context) => {
  const { common } = context;

  const { eventCallbacks } = getAccountsIndexingBuild({
    address: ALICE,
  });

  const blockData = await transferEth({
    to: BOB,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const rawEvent = {
    chain: getChain(),
    eventCallback: eventCallbacks[2],
    checkpoint: ZERO_CHECKPOINT_STRING,
    block: syncBlockToInternal({ block: blockData.block }),
    transaction: syncTransactionToInternal({
      transaction: blockData.transaction,
    }),
    log: undefined,
    trace: syncTraceToInternal({
      trace: blockData.trace,
      block: blockData.block,
      transaction: blockData.transaction,
    }),
  } as RawEvent;

  const events = decodeEvents(common, [rawEvent]) as [TransferEvent];

  expect(events).toHaveLength(1);
  expect(events[0].event.transfer).toMatchObject({
    from: toLowerCase(ALICE),
    to: toLowerCase(BOB),
    value: parseEther("1"),
  });
});

test("decodeEvents() transaction", async (context) => {
  const { common } = context;

  const { eventCallbacks } = getAccountsIndexingBuild({
    address: ALICE,
  });

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });
  const blockData = await transferErc20({
    erc20: address,
    to: BOB,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const rawEvent = {
    chain: getChain(),
    eventCallback: eventCallbacks[0],
    checkpoint: ZERO_CHECKPOINT_STRING,
    block: syncBlockToInternal({ block: blockData.block }),
    transaction: syncTransactionToInternal({
      transaction: blockData.transaction,
    }),
    transactionReceipt: syncTransactionReceiptToInternal({
      transactionReceipt: blockData.transactionReceipt,
    }),
    log: undefined,
    trace: syncTraceToInternal({
      trace: blockData.trace,
      block: blockData.block,
      transaction: blockData.transaction,
    }),
  } as RawEvent;

  const events = decodeEvents(common, [rawEvent]) as [TransferEvent];

  expect(events).toHaveLength(1);
});

test("decodeEvents() trace", async (context) => {
  const { common } = context;

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });
  const blockData = await transferErc20({
    erc20: address,
    to: BOB,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({
    address: zeroAddress,
    includeCallTraces: true,
  });

  const rawEvent = {
    chain: getChain(),
    eventCallback: eventCallbacks[0],
    checkpoint: ZERO_CHECKPOINT_STRING,
    block: syncBlockToInternal({ block: blockData.block }),
    transaction: syncTransactionToInternal({
      transaction: blockData.transaction,
    }),
    transactionReceipt: undefined,
    log: undefined,
    trace: syncTraceToInternal({
      trace: blockData.trace,
      block: blockData.block,
      transaction: blockData.transaction,
    }),
  } as RawEvent;

  const events = decodeEvents(common, [rawEvent]) as [TraceEvent];

  expect(events).toHaveLength(1);
  expect(events[0].event.args).toStrictEqual([BOB, parseEther("1")]);
  expect(events[0].event.result).toBe(true);
});

test("decodeEvents() trace w/o output", async (context) => {
  const { common } = context;

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });
  const blockData = await transferErc20({
    erc20: address,
    to: BOB,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({
    address: zeroAddress,
    includeCallTraces: true,
  });

  // Remove output from the trace abi
  // @ts-ignore
  eventCallbacks[0].abiItem.outputs = [];

  const rawEvent = {
    chain: getChain(),
    eventCallback: eventCallbacks[0],
    checkpoint: ZERO_CHECKPOINT_STRING,
    block: syncBlockToInternal({ block: blockData.block }),
    transaction: syncTransactionToInternal({
      transaction: blockData.transaction,
    }),
    transactionReceipt: undefined,
    log: undefined,
    trace: syncTraceToInternal({
      trace: blockData.trace,
      block: blockData.block,
      transaction: blockData.transaction,
    }),
  } as RawEvent;

  const events = decodeEvents(common, [rawEvent]) as [TraceEvent];

  expect(events).toHaveLength(1);
  expect(events[0].event.args).toStrictEqual([BOB, parseEther("1")]);
  expect(events[0].event.result).toBe(undefined);
});

test("decodeEvents() trace error", async (context) => {
  const { common } = context;

  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });
  const blockData = await transferErc20({
    erc20: address,
    to: BOB,
    amount: parseEther("1"),
    sender: ALICE,
  });

  const { eventCallbacks } = getErc20IndexingBuild({
    address: zeroAddress,
    includeCallTraces: true,
  });

  const rawEvent = {
    chain: getChain(),
    eventCallback: eventCallbacks[0],
    checkpoint: ZERO_CHECKPOINT_STRING,
    block: syncBlockToInternal({ block: blockData.block }),
    transaction: syncTransactionToInternal({
      transaction: blockData.transaction,
    }),
    transactionReceipt: undefined,
    log: undefined,
    trace: syncTraceToInternal({
      trace: blockData.trace,
      block: blockData.block,
      transaction: blockData.transaction,
    }),
  } as RawEvent;

  // Remove input from the trace to cause error
  rawEvent.trace!.input = "0x";

  const events = decodeEvents(common, [rawEvent]) as [TraceEvent];

  expect(events).toHaveLength(0);
});
