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
        `Did not receive event: ("${String(expected[index].name)}")`
      );
    }

    const { value } = result as { value: [string, any]; done: boolean };
    const [eventName, data] = value;

    expect(eventName).toBe(expected[index].name);
    expect(data).toMatchObject(expected[index].value);

    index++;
  }
}
