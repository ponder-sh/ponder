import { assertType, test } from "vitest";
import type { IndexingSink } from "../index.js";
import { createConfig } from "./index.js";

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
