import path from "node:path";
import { ALICE, BOB } from "@/_test/constants.js";
import {
  setupAnvil,
  setupCommon,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { simulate } from "@/_test/simulate.js";
import {
  getFreePort,
  postGraphql,
  waitForIndexedBlock,
} from "@/_test/utils.js";
import { serve } from "@/bin/commands/serve.js";
import { start } from "@/bin/commands/start.js";
import { range } from "@/utils/range.js";
import { rimrafSync } from "rimraf";
import { zeroAddress } from "viem";
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
  root: rootDir,
  config: "ponder.config.ts",
  logLevel: "error",
  logFormat: "pretty",
};

test("erc20", async (context) => {
  const port = await getFreePort();

  const cleanup = await start({
    cliOptions: {
      ...cliOptions,
      command: "start",
      port,
    },
  });

  await simulate({
    erc20Address: context.erc20.address,
    factoryAddress: context.factory.address,
  });

  await waitForIndexedBlock(port, "mainnet", 8);

  const response = await postGraphql(
    port,
    `
    accounts {
      items {
        id
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
    id: zeroAddress,
    balance: (-2 * 10 ** 18).toString(),
  });
  expect(accounts[1]).toMatchObject({
    id: BOB.toLowerCase(),
    balance: (2 * 10 ** 18).toString(),
  });
  expect(accounts[2]).toMatchObject({
    id: ALICE.toLowerCase(),
    balance: "0",
  });

  await cleanup();
});

const shouldSkip = process.env.DATABASE_URL === undefined;

// Fix this once it's easier to have per-command kill functions in Ponder.ts.
describe.skipIf(shouldSkip)("postgres database", () => {
  test.todo("ponder serve", async (context) => {
    const startPort = await getFreePort();

    const cleanupStart = await start({
      cliOptions: {
        ...cliOptions,
        command: "start",
        port: startPort,
      },
    });

    for (const _ in range(0, 3)) {
      await simulate({
        erc20Address: context.erc20.address,
        factoryAddress: context.factory.address,
      });
    }

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
          id
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
      id: zeroAddress,
      balance: (-4 * 10 ** 18).toString(),
    });
    expect(accounts[1]).toMatchObject({
      id: BOB.toLowerCase(),
      balance: (4 * 10 ** 18).toString(),
    });
    expect(accounts[2]).toMatchObject({
      id: ALICE.toLowerCase(),
      balance: "0",
    });

    await cleanupServe();
    await cleanupStart();
  });
});
