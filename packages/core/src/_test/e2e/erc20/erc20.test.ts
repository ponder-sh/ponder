import net, { type AddressInfo } from "net";
import { rmSync } from "node:fs";
import { ALICE, BOB } from "@/_test/constants.js";
import { setupAnvil, setupIsolatedDatabase } from "@/_test/setup.js";
import { simulate, simulateErc20 } from "@/_test/simulate.js";
import { onAllEventsIndexed } from "@/_test/utils.js";
import { start } from "@/bin/commands/start.js";
import { range } from "@/utils/range.js";
import { wait } from "@/utils/wait.js";
import { zeroAddress } from "viem";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);

afterEach(() => {
  rmSync("./src/_test/e2e/erc20/.ponder", {
    recursive: true,
    force: true,
    retryDelay: 20,
  });
  rmSync("./src/_test/e2e/erc20/generated", {
    recursive: true,
    force: true,
  });
});

function getPortFree(): Promise<number> {
  return new Promise((res) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close(() => res(port));
    });
  });
}

async function waitForHealthy(port: number) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      clearInterval(interval);
      reject(new Error("Timed out while waiting for app to become healthy."));
    }, 5_000);
    const interval = setInterval(async () => {
      const response = await fetch(`http://localhost:${port}/health`);
      if (response.status === 200) {
        clearTimeout(timeout);
        clearInterval(interval);
        resolve(undefined);
      }
    }, 20);
  });
}

async function postGraphql(port: number, query: string) {
  const response = await fetch(`http://localhost:${port}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: `query { ${query} }` }),
  });
  return response;
}

async function getMetrics(port: number) {
  const response = await fetch(`http://localhost:${port}/metrics`);
  return await response.text();
}

test.only("erc20", async (context) => {
  for (const _ in range(0, 3)) {
    await simulate({
      erc20Address: context.erc20.address,
      factoryAddress: context.factory.address,
    });
  }

  const port = await getPortFree();

  const cleanup = await start({
    cliOptions: {
      root: "./src/_test/e2e/erc20",
      config: "ponder.config.ts",
      port,
    },
  });

  await waitForHealthy(port);

  await wait(100);

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

// const shouldSkip = process.env.DATABASE_URL === undefined;

// // Fix this once it's easier to have per-command kill functions in Ponder.ts.
// describe.skipIf(shouldSkip)("postgres database", () => {
//   test.todo("ponder serve", async (context) => {
//     const options = buildOptions({
//       cliOptions: { root: "./src/_test/e2e/erc20", config: "ponder.config.ts" },
//     });
//     const testOptions = {
//       ...options,
//       uiEnabled: false,
//       logLevel: "error",
//       telemetryDisabled: true,
//     } as const;

//     for (const _ in range(0, 3)) {
//       await simulate({
//         erc20Address: context.erc20.address,
//         factoryAddress: context.factory.address,
//       });
//     }

//     const ponder = new Ponder({ options: testOptions });
//     await ponder.start(context.databaseConfig);
//     await onAllEventsIndexed(ponder);

//     const ponderServe = new Ponder({ options: testOptions });
//     await ponderServe.serve(context.databaseConfig);

//     const accounts = await gql(
//       ponderServe,
//       `
//       accounts {
//         items {
//           id
//           balance
//         }
//       }
//       `,
//     ).then((g) => g.accounts.items);

//     expect(accounts).toHaveLength(3);
//     expect(accounts[0]).toMatchObject({
//       id: zeroAddress,
//       balance: (-4 * 10 ** 18).toString(),
//     });
//     expect(accounts[1]).toMatchObject({
//       id: BOB.toLowerCase(),
//       balance: (4 * 10 ** 18).toString(),
//     });
//     expect(accounts[2]).toMatchObject({
//       id: ALICE.toLowerCase(),
//       balance: "0",
//     });

//     await ponderServe.kill();
//     await ponder.kill();
//   });
// });
