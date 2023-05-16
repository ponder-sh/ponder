/* eslint-disable @typescript-eslint/ban-ts-comment */
import { fetchLogs } from "@viem/anvil";
import moduleAlias from "module-alias";
import path from "node:path";
import fetch, { Headers, Request, Response } from "node-fetch";
import { afterAll, afterEach } from "vitest";

import { FORK_BLOCK_NUMBER, FORK_URL } from "./constants";
import { poolId, testClient } from "./utils";

// Set up a fetch polyfill for test runs using Node <16.
if (!globalThis.fetch) {
  //@ts-ignore
  globalThis.fetch = fetch;
  //@ts-ignore
  globalThis.Headers = Headers;
  //@ts-ignore
  globalThis.Request = Request;
  //@ts-ignore
  globalThis.Response = Response;
}

// Setup up a package alias so we can reference `@ponder/core` by name in test files.
const ponderCoreDir = path.resolve(__dirname, "../../");
moduleAlias.addAlias("@ponder/core", ponderCoreDir);

// afterAll(async () => {
//   // This resets the anvil instance to the initial fork block.
//   await testClient.reset({
//     jsonRpcUrl: FORK_URL,
//     blockNumber: FORK_BLOCK_NUMBER,
//   });
// });

// afterEach(async (context) => {
//   context.onTestFailed(async () => {
//     const logs = await fetchLogs("http://localhost:8545", poolId);
//     console.log(...logs.slice(-20));
//   });
// });
