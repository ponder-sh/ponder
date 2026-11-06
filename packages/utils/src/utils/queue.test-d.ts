import { expectTypeOf, test } from "bun:test";
import { createQueue } from "./queue.js";

test("add type", () => {
  const queue = createQueue({
    concurrency: 1,
    worker: (_arg: "a" | "b" | "c") => Promise.resolve(),
  });

  expectTypeOf(queue.add).toExtend<(task: "a" | "b" | "c") => Promise<void>>();
});
