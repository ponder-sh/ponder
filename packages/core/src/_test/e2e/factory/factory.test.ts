import path from "node:path";
import { ALICE } from "@/_test/constants.js";
import {
  setupAnvil,
  setupCommon,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { deployFactory } from "@/_test/simulate.js";
import { createPair } from "@/_test/simulate.js";
import { swapPair } from "@/_test/simulate.js";
import { getFreePort, waitForIndexedBlock } from "@/_test/utils.js";
import { start } from "@/bin/commands/start.js";
import { createClient } from "@ponder/client";
import { rimrafSync } from "rimraf";
import { beforeEach, expect, test } from "vitest";
import * as schema from "./ponder.schema.js";

const rootDir = path.join(".", "src", "_test", "e2e", "factory");
beforeEach(() => {
  rimrafSync(path.join(rootDir, ".ponder"));
  rimrafSync(path.join(rootDir, "generated"));
});

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

const cliOptions = {
  schema: "public",
  root: "./src/_test/e2e/factory",
  config: "ponder.config.ts",
  logLevel: "error",
  logFormat: "pretty",
};

test(
  "factory",
  async () => {
    const port = await getFreePort();
    const client = createClient(`http://localhost:${port}/sql`, { schema });

    const shutdown = await start({
      cliOptions: {
        ...cliOptions,
        command: "start",
        port,
        version: "0.0.0",
      },
    });

    const { address } = await deployFactory({ sender: ALICE });
    const { result: pair } = await createPair({
      factory: address,
      sender: ALICE,
    });
    await swapPair({
      pair,
      amount0Out: 1n,
      amount1Out: 1n,
      to: ALICE,
      sender: ALICE,
    });

    await waitForIndexedBlock({
      port,
      chainId: 1,
      block: { number: 3 },
    });

    let result = await client.db.select().from(schema.swapEvent);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: expect.any(String),
      from: ALICE.toLowerCase(),
      to: ALICE.toLowerCase(),
      pair,
    });

    await swapPair({
      pair,
      amount0Out: 1n,
      amount1Out: 1n,
      to: ALICE,
      sender: ALICE,
    });

    await waitForIndexedBlock({
      port,
      chainId: 1,
      block: { number: 4 },
    });

    result = await client.db.select().from(schema.swapEvent);

    expect(result).toHaveLength(2);

    await shutdown!();
  },
  { timeout: 15_000 },
);
