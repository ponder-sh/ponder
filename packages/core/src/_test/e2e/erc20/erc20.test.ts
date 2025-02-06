import path from "node:path";
import { ALICE } from "@/_test/constants.js";
import {
  setupAnvil,
  setupCommon,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { deployErc20, mintErc20 } from "@/_test/simulate.js";
import { getFreePort, waitForIndexedBlock } from "@/_test/utils.js";
import { serve } from "@/bin/commands/serve.js";
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
      networkName: "mainnet",
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

const isPglite = !!process.env.DATABASE_URL;

// Fix this once it's easier to have per-command kill functions in Ponder.ts.

test("ponder serve", async () => {
  if (isPglite) return;
  const startPort = await getFreePort();
  const client = createClient(`http://localhost:${startPort}/sql`, {
    schema,
  });

  const shutdownStart = await start({
    cliOptions: {
      ...cliOptions,
      command: "start",
      port: startPort,
    },
  });

  const { address } = await deployErc20({ sender: ALICE });

  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });
  const servePort = await getFreePort();

  const shutdownServe = await serve({
    cliOptions: {
      ...cliOptions,
      command: "serve",
      port: servePort,
    },
  });

  const result = await client.db.select().from(schema.account);

  expect(result).toHaveLength(3);
  expect(result[0]).toMatchObject({
    address: zeroAddress,
    balance: (-1 * 10 ** 18).toString(),
  });
  expect(result[1]).toMatchObject({
    address: ALICE.toLowerCase(),
    balance: (10 ** 18).toString(),
  });

  await shutdownServe!();
  await shutdownStart!();
});
