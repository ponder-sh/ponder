import { expect } from "vitest";

import { wait } from "./wait";

export async function expectEvents<Events extends Record<string, any>>(
  iterator: AsyncIterableIterator<[keyof Events, any]>,
  expected: { name: keyof Events; value: Events[keyof Events] }[]
) {
  let index = 0;

  while (index < expected.length) {
    const result = await Promise.race([iterator.next(), wait(10)]);

    if (result === undefined) {
      throw new Error(
        `Did not receive event "${String(
          expected[index].name
        )}" at index ${index}`
      );
    }

    const { value } = result as { value: [string, any]; done: boolean };
    const [eventName, data] = value;

    // Ignore internal events like Symbol("listenerAdded")
    if (typeof eventName === "symbol") {
      continue;
    }

    // Ignore events that we don't specifically expect.
    if (expected[index].name !== eventName) {
      continue;
    }

    expect({ eventName: eventName, data: data }).toMatchObject({
      eventName,
      data: expected[index].value,
    });

    index++;
  }
}
