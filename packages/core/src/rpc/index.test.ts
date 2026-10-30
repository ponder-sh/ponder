import { expect, test } from "vitest";
import { sanitizeLogTopics } from "./index.js";

const topic0 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const topic1 =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as const;

test("sanitizeLogTopics removes trailing null values", () => {
  expect(sanitizeLogTopics([topic0, topic1, null, null])).toStrictEqual([
    topic0,
    topic1,
  ]);
});

test("sanitizeLogTopics preserves null wildcards before a topic", () => {
  expect(sanitizeLogTopics([topic0, null, topic1, null])).toStrictEqual([
    topic0,
    null,
    topic1,
  ]);
});

test("sanitizeLogTopics does not mutate the input", () => {
  const topics = [topic0, null, null] as const;

  expect(sanitizeLogTopics(topics)).toStrictEqual([topic0]);
  expect(topics).toStrictEqual([topic0, null, null]);
});

test("sanitizeLogTopics preserves omitted and empty topics", () => {
  expect(sanitizeLogTopics([])).toMatchInlineSnapshot(`[]`);
  expect(sanitizeLogTopics([null, null])).toMatchInlineSnapshot(`[]`);
});
