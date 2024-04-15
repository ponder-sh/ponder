import { assertType, expect, test } from "vitest";
import { extend } from "./extend.js";

test("extend", () => {
  const create = (n: number) => ({ type: "created", n }) as const;

  const extended = extend(create, {
    add: (params: ReturnType<typeof create>, x: number) => params.n + x,
  });

  const created = extended(5);

  expect(created.type).toBe("created");
  expect(created.n).toBe(5);
  expect(created.add(1)).toBe(6);

  assertType<
    (n: number) => { type: "created"; n: number; add: (x: number) => number }
  >(extended);
});

test("extend with promise", async () => {
  const create = (n: number) =>
    Promise.resolve({ type: "created", n } as const);

  const extended = extend(create, {
    add: (params: Awaited<ReturnType<typeof create>>, x: number) =>
      params.n + x,
  });

  const created = await extended(5);

  expect(created.type).toBe("created");
  expect(created.n).toBe(5);
  expect(created.add(1)).toBe(6);

  assertType<
    (
      n: number,
    ) => Promise<{ type: "created"; n: number; add: (x: number) => number }>
  >(extended);
});
