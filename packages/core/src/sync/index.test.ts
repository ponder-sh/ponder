import { setupCommon, setupIsolatedDatabase } from "@/_test/setup.js";
import { setupAnvil } from "@/_test/setup.js";
import type { RawEvent } from "@/internal/types.js";
import { beforeEach, expect, test } from "vitest";
import { splitEvents } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);
test("splitEvents()", async () => {
  const events = [
    {
      chainId: 1,
      checkpoint: "0",
      block: {
        hash: "0x1",
        timestamp: 1,
        number: 1n,
      },
      sourceIndex: 0,
    },
    {
      chainId: 1,
      checkpoint: "0",
      block: {
        hash: "0x2",
        timestamp: 2,
        number: 2n,
      },
      sourceIndex: 0,
    },
  ] as unknown as RawEvent[];

  const result = splitEvents(events);

  expect(result).toMatchInlineSnapshot(`
    [
      {
        "checkpoint": "000000000100000000000000010000000000000001999999999999999999999999999999999",
        "events": [
          {
            "block": {
              "hash": "0x1",
              "number": 1n,
              "timestamp": 1,
            },
            "chainId": 1,
            "checkpoint": "0",
            "sourceIndex": 0,
          },
        ],
      },
      {
        "checkpoint": "000000000200000000000000010000000000000002999999999999999999999999999999999",
        "events": [
          {
            "block": {
              "hash": "0x2",
              "number": 2n,
              "timestamp": 2,
            },
            "chainId": 1,
            "checkpoint": "0",
            "sourceIndex": 0,
          },
        ],
      },
    ]
  `);
});

test("getLocalSyncGenerator()", async () => {});

test("getLocalEventGenerator()", async () => {});

test("getLocalSyncProgress()", async () => {});

test("getCachedBlock()");
