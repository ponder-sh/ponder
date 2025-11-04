import { expect, test } from "vitest";
import { promiseAllSettledWithThrow } from "./promiseAllSettledWithThrow.js";

test("promiseAllSettledWithThrow", async () => {
  await expect(() =>
    promiseAllSettledWithThrow([
      Promise.resolve(1),
      new Promise((resolve) => setTimeout(() => resolve(2), 10)),
      new Promise((_, reject) => setTimeout(() => reject(new Error("1")), 10)),
      new Promise((_, reject) => setTimeout(() => reject(new Error("2")), 20)),
    ]),
  ).rejects.toThrowErrorMatchingInlineSnapshot("[Error: 1]");
});
