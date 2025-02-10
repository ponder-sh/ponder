import { assertType, test } from "vitest";
import { createQueue } from "./queue.js";

test("add type", () => {
  const queue = createQueue({
    concurrency: 1,
    worker: (_arg: "a" | "b" | "c") => Promise.resolve(),
  });

  assertType<(task: "a" | "b" | "c") => Promise<void>>(queue.add);
});
