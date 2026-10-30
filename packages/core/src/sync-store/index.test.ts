import { expect, test } from "vitest";
import { getFilterBlockRange } from "./index.js";

test("getFilterBlockRange() merges filter and pagination bounds", () => {
  expect(
    getFilterBlockRange({
      filters: [
        { fromBlock: 10, toBlock: 80 },
        { fromBlock: 20, toBlock: 90 },
      ],
      fromBlock: 0,
      toBlock: 100,
    }),
  ).toMatchInlineSnapshot(`
    {
      "fromBlock": 10,
      "toBlock": 90,
    }
  `);

  expect(
    getFilterBlockRange({
      filters: [
        { fromBlock: 10, toBlock: 80 },
        { fromBlock: undefined, toBlock: undefined },
      ],
      fromBlock: 20,
      toBlock: 70,
    }),
  ).toMatchInlineSnapshot(`
    {
      "fromBlock": 20,
      "toBlock": 70,
    }
  `);

  expect(
    getFilterBlockRange({
      filters: [{ fromBlock: 0, toBlock: 30 }],
      fromBlock: 20,
      toBlock: 90,
    }),
  ).toMatchInlineSnapshot(`
    {
      "fromBlock": 20,
      "toBlock": 30,
    }
  `);

  expect(
    getFilterBlockRange({ filters: [], fromBlock: 20, toBlock: 90 }),
  ).toMatchInlineSnapshot(`
    {
      "fromBlock": 20,
      "toBlock": 90,
    }
  `);
});
