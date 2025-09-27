import { toBytes, zeroAddress } from "viem";
import { expect, test } from "vitest";
import { copy, copyOnWrite } from "./copy.js";

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

  expect(obj.a).toEqual([]);
  expect(copiedObj.a).toEqual([1]);
});

test("copy", () => {
  const obj = { a: 1, b: 2 };
  const copiedObj = copyOnWrite(obj);
  const copiedObj2 = copy(copiedObj);

  expect(copiedObj.a).toBe(1);
  expect(copiedObj.b).toBe(2);

  expect(copiedObj2.a).toBe(1);
  expect(copiedObj2.b).toBe(2);

  copiedObj.a = 3;

  expect(obj.a).toBe(1);
  expect(obj.b).toBe(2);

  expect(copiedObj.a).toBe(3);
  expect(copiedObj.b).toBe(2);

  copy([copiedObj]);
});

test("copy bytes", () => {
  const obj = {
    address: zeroAddress,
    calldata: toBytes(zeroAddress),
  };

  const copiedObj = copy(obj);

  expect(copiedObj.calldata).toBeInstanceOf(Uint8Array);
});
