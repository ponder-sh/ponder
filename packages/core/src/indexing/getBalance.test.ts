import { createClient, http } from "viem";
import { beforeEach, expect, test } from "vitest";

import { setupEventStore } from "@/_test/setup";
import { anvil } from "@/_test/utils";

import { buildGetBalance } from "./getBalance";
import { ponderTransport } from "./transport";

beforeEach((context) => setupEventStore(context));

test("getBalance() no cache", async ({ eventStore }) => {
  const client = createClient({
    chain: anvil,
    transport: ponderTransport({ transport: http(), eventStore }),
  });

  const getBalance = buildGetBalance({
    getCurrentBlockNumber: () => 16375000n,
  });

  const balance = await getBalance(client, {
    address: "0xA0Cf798816D4b9b9866b5330EEa46a18382f251e",
  });

  expect(balance).toBe(398806329552690329n);
});

test("getBalance() with cache", async ({ eventStore }) => {
  const client = createClient({
    chain: anvil,
    transport: ponderTransport({ transport: http(), eventStore }),
  });

  const getBalance = buildGetBalance({
    getCurrentBlockNumber: () => 16375000n,
  });

  let balance = await getBalance(client, {
    address: "0xA0Cf798816D4b9b9866b5330EEa46a18382f251e",
  });

  expect(balance).toBe(398806329552690329n);

  balance = await getBalance(client, {
    address: "0xA0Cf798816D4b9b9866b5330EEa46a18382f251e",
  });

  expect(balance).toBe(398806329552690329n);
});
