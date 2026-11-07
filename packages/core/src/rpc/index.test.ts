import { expect, test } from "bun:test";
import type { LogTopic } from "viem";
import { sanitizeLogTopics } from "./index.js";

const topic0 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const topic1 =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as const;

test("sanitizeLogTopics removes trailing null values", () => {
  expect(
    sanitizeLogTopics([topic0, topic1, null, null]),
  ).toMatchInlineSnapshot(`
    [
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      "0x1111111111111111111111111111111111111111111111111111111111111111",
    ]
  `);
});

test("sanitizeLogTopics preserves null wildcards before a topic", () => {
  expect(
    sanitizeLogTopics([topic0, null, topic1, null]),
  ).toMatchInlineSnapshot(`
    [
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      null,
      "0x1111111111111111111111111111111111111111111111111111111111111111",
    ]
  `);
});

test("sanitizeLogTopics does not mutate the input", () => {
  const topics: LogTopic[] = [topic0, null, null];

  expect(sanitizeLogTopics(topics)).toMatchInlineSnapshot(`
    [
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    ]
  `);
  expect(topics).toMatchInlineSnapshot(`
    [
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      null,
      null,
    ]
  `);
});

test("sanitizeLogTopics preserves omitted and empty topics", () => {
  expect(sanitizeLogTopics([])).toMatchInlineSnapshot(`[]`);
  expect(sanitizeLogTopics([null, null])).toMatchInlineSnapshot(`[]`);
});
