import { assertType, test } from "vitest";
import type { CreateConfigReturnType, IndexingSink } from "../index.js";
import { createConfig } from "./index.js";

test("CreateConfigReturnType generic defaults", () => {
  const sink = {
    name: "analytics",
    writeFinalizedBatch: async () => {},
  } satisfies IndexingSink;

  assertType<CreateConfigReturnType<{}, {}, {}, {}>>({
    chains: {},
    contracts: {},
    accounts: {},
    blocks: {},
  });
  assertType<CreateConfigReturnType<{}, {}, {}, {}, readonly [typeof sink]>>({
    chains: {},
    contracts: {},
    accounts: {},
    blocks: {},
    sinks: [sink] as const,
  });
});

test("createConfig sinks", () => {
  const sink = {
    name: "analytics",
    writeFinalizedBatch: async () => {},
  } satisfies IndexingSink;
  const config = createConfig({
    chains: {
      mainnet: { id: 1, rpc: "https://rpc.com" },
    },
    sinks: [sink],
  });

  assertType<readonly IndexingSink[] | undefined>(config.sinks);
});

test("createConfig rejects invalid sinks", () => {
  createConfig({
    chains: {
      mainnet: { id: 1, rpc: "https://rpc.com" },
    },
    sinks: [
      {
        name: "analytics",
        // @ts-expect-error
        writeFinalizedBatch: undefined,
      },
    ],
  });
});
