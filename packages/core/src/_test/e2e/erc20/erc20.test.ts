import path from "node:path";
import { ALICE } from "@/_test/constants.js";
import {
  setupAnvil,
  setupCommon,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { deployErc20, mintErc20 } from "@/_test/simulate.js";
import { getFreePort, waitForIndexedBlock } from "@/_test/utils.js";
import { start } from "@/bin/commands/start.js";
import { createClient } from "@ponder/client";
import { rimrafSync } from "rimraf";
import { parseEther, zeroAddress } from "viem";
import { beforeEach, expect, test } from "vitest";
import * as schema from "./ponder.schema.js";

const rootDir = path.join(".", "src", "_test", "e2e", "erc20");
beforeEach(() => {
  rimrafSync(path.join(rootDir, ".ponder"));
  rimrafSync(path.join(rootDir, "generated"));
});

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

const cliOptions = {
  schema: "public",
  root: rootDir,
  config: "ponder.config.ts",
  logLevel: "error",
  logFormat: "pretty",
};

test(
  "erc20",
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

    const { address } = await deployErc20({ sender: ALICE });

    await mintErc20({
      erc20: address,
      to: ALICE,
      amount: parseEther("1"),
      sender: ALICE,
    });
    await waitForIndexedBlock({
      port,
      chainName: "mainnet",
      block: { number: 2 },
    });
    const result = await client.db.select().from(schema.account);

    expect(result[0]).toMatchObject({
      address: zeroAddress,
      balance: -1n * 10n ** 18n,
    });
    expect(result[1]).toMatchObject({
      address: ALICE.toLowerCase(),
      balance: 10n ** 18n,
    });

    await shutdown!();
  },
  { timeout: 15_000 },
);
