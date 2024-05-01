import path from "node:path";
import { ALICE, BOB } from "@/_test/constants.js";
import {
  setupAnvil,
  setupCommon,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { simulate } from "@/_test/simulate.js";
import { getFreePort, postGraphql, waitForHealthy } from "@/_test/utils.js";
import { serve } from "@/bin/commands/serve.js";
import { start } from "@/bin/commands/start.js";
import { range } from "@/utils/range.js";
import { wait } from "@/utils/wait.js";
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

test("erc20", async (context) => {
  const port = await getFreePort();

  const cleanup = await start({
    cliOptions: {
      command: "start",
      root: rootDir,
      config: "ponder.config.ts",
      port,
    },
  });

  await waitForHealthy(port);

  let response = await postGraphql(
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
  let body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  let accounts = body.data.accounts.items;

  expect(accounts).toHaveLength(3);
  expect(accounts[0]).toMatchObject({
    id: zeroAddress,
    balance: (-1 * 10 ** 18).toString(),
  });
  expect(accounts[1]).toMatchObject({
    id: BOB.toLowerCase(),
    balance: (1 * 10 ** 18).toString(),
  });
  expect(accounts[2]).toMatchObject({
    id: ALICE.toLowerCase(),
    balance: "0",
  });

  await simulate({
    erc20Address: context.erc20.address,
    factoryAddress: context.factory.address,
  });

  // TODO: Find a consistent way to wait for indexing to be complete.
  await wait(2500);

  response = await postGraphql(
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
  body = (await response.json()) as any;
  expect(body.errors).toBe(undefined);
  accounts = body.data.accounts.items;

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
        command: "start",
        root: "./src/_test/e2e/erc20",
        config: "ponder.config.ts",
        port: startPort,
      },
    });

    await waitForHealthy(startPort);

    for (const _ in range(0, 3)) {
      await simulate({
        erc20Address: context.erc20.address,
        factoryAddress: context.factory.address,
      });
    }

    const servePort = await getFreePort();

    const cleanupServe = await serve({
      cliOptions: {
        command: "serve",
        root: "./src/_test/e2e/erc20",
        config: "ponder.config.ts",
        port: servePort,
      },
    });

    await waitForHealthy(servePort);

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
