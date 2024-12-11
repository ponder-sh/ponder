import path from "node:path";
import { ALICE } from "@/_test/constants.js";
import {
  setupAnvil,
  setupCommon,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { deployErc20, mintErc20 } from "@/_test/simulate.js";
import {
  getFreePort,
  postGraphql,
  waitForIndexedBlock,
} from "@/_test/utils.js";
import { serve } from "@/bin/commands/serve.js";
import { start } from "@/bin/commands/start.js";
import { rimrafSync } from "rimraf";
import { parseEther, zeroAddress } from "viem";
import { beforeEach, describe, expect, test } from "vitest";

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

    const cleanup = await start({
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

    await waitForIndexedBlock(port, "mainnet", 2);

    const response = await postGraphql(
      port,
      `
    accounts {
      items {
        address
        balance
      }
    }
    `,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;

    expect(body.errors).toBe(undefined);
    const accounts = body.data.accounts.items;
    expect(accounts[0]).toMatchObject({
      address: zeroAddress,
      balance: (-1 * 10 ** 18).toString(),
    });
    expect(accounts[1]).toMatchObject({
      address: ALICE.toLowerCase(),
      balance: (10 ** 18).toString(),
    });

    await cleanup();
  },
  { timeout: 15_000 },
);

const isPglite = !!process.env.DATABASE_URL;

// Fix this once it's easier to have per-command kill functions in Ponder.ts.
describe.skipIf(isPglite)("postgres database", () => {
  test.todo("ponder serve", async () => {
    const startPort = await getFreePort();

    const cleanupStart = await start({
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

    const cleanupServe = await serve({
      cliOptions: {
        ...cliOptions,
        command: "serve",
        port: servePort,
      },
    });

    const response = await postGraphql(
      servePort,
      `
      accounts {
        items {
          address
          balance
        }
      }
      `,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.errors).toBe(undefined);
    const accounts = body.data.accounts.items;

    expect(accounts).toHaveLength(3);
    expect(accounts[0]).toMatchObject({
      address: zeroAddress,
      balance: (-1 * 10 ** 18).toString(),
    });
    expect(accounts[1]).toMatchObject({
      address: ALICE.toLowerCase(),
      balance: (10 ** 18).toString(),
    });

    await cleanupServe();
    await cleanupStart();
  });
});
