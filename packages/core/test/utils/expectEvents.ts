import { expect } from "vitest";

import { wait } from "@/utils/wait";

export async function expectEvents<TEventNames extends string>(
  iterator: AsyncIterableIterator<[TEventNames, any]>,
  expected: Partial<Record<TEventNames, number>>
) {
  const actual: Record<string, number> = {};
  Object.keys(expected).forEach((key) => {
    actual[key] = 0;
  });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await Promise.race([iterator.next(), wait(1)]);

    // If result is undefined, there are no more events.
    if (!result) break;

    const { value } = result as { value: [string, any] };
    const eventName = value[0];

    // Ignore internal events like Symbol("listenerAdded")
    if (typeof eventName === "symbol") continue;

    // Ignore events not present in expected
    if (!(eventName in expected)) continue;

    actual[eventName] += 1;
  }

  expect(actual).toMatchObject(expected);
}
