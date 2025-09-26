import { expect, test } from "vitest";
import { copyOnWrite } from "./cow.js";

test("copyOnWrite", () => {
  const obj = { a: 1, b: 2 };
  const copiedObj = copyOnWrite(obj);

  expect(obj.a).toBe(1);
  expect(obj.b).toBe(2);

  expect(copiedObj.a).toBe(1);
  expect(copiedObj.b).toBe(2);

  copiedObj.a = 3;

  expect(obj.a).toBe(1);
  expect(obj.b).toBe(2);

  expect(copiedObj.a).toBe(3);
  expect(copiedObj.b).toBe(2);

  // @ts-expect-error
  copiedObj.c = 10;

  // @ts-expect-error
  expect(obj.c).toBeUndefined();

  // @ts-expect-error
  expect(copiedObj.c).toBe(10);
});

test("copyOnWrite nested", () => {
  const obj = { a: { c: 1 }, b: 2 };
  const copiedObj = copyOnWrite(obj);

  expect(obj.a.c).toBe(1);
  expect(obj.b).toBe(2);

  expect(copiedObj.a.c).toBe(1);
  expect(copiedObj.b).toBe(2);

  copiedObj.a.c = 2;

  expect(obj.a.c).toBe(1);

  expect(copiedObj.a.c).toBe(2);
});

test("copyOnWrite nested array", () => {
  const obj = { a: [] as number[] };
  const copiedObj = copyOnWrite(obj);

  copiedObj.a.push(1);
});
