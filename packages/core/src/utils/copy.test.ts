import util from "node:util";
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

test("copyOnWrite inspect", () => {
  const obj = { a: 1, b: 2 };
  const inspectedObj = util.inspect(obj);
  const copiedObj = copyOnWrite(obj);

  expect(util.inspect(copiedObj)).toBe(inspectedObj);

  copiedObj.a = 3;

  expect(util.inspect(copiedObj)).toBe("{ a: 3, b: 2 }");
});

test("copyOnWrite inspect array", () => {
  const array = [1, 2];
  const inspectedArray = util.inspect(array);
  const copiedArray = copyOnWrite(array);

  expect(util.inspect(copiedArray)).toBe(inspectedArray);

  copiedArray.push(3);

  expect(util.inspect(copiedArray)).toBe("[ 1, 2, 3 ]");
  expect([...array]).toEqual([1, 2]);
});

test("copyOnWrite inspect symbol and prototype", () => {
  const symbol = Symbol("value");
  class Row {
    value = 1;
    [symbol] = { nested: 1 };
  }
  const obj = new Row();
  const inspectedObj = util.inspect(obj);
  const copiedObj = copyOnWrite(obj);

  expect(util.inspect(copiedObj)).toBe(inspectedObj);

  copiedObj[symbol].nested = 2;

  const expectedObj = new Row();
  expectedObj[symbol].nested = 2;
  expect(util.inspect(copiedObj)).toBe(util.inspect(expectedObj));
  expect(copiedObj).toBeInstanceOf(Row);
  expect(obj[symbol].nested).toBe(1);
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
  const copiedObj = copyOnWrite(obj);
  const copiedObj2 = copy(copiedObj);

  expect(copiedObj.calldata).toMatchInlineSnapshot(`
    Uint8Array [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ]
  `);

  expect(copiedObj2.calldata).toMatchInlineSnapshot(`
    Uint8Array [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ]
  `);

  expect(copiedObj.calldata).toBeInstanceOf(Uint8Array);
  expect(copiedObj2.calldata).toBeInstanceOf(Uint8Array);
});

test("copyOnWrite nested date and bytes", () => {
  const obj = {
    bytes: new Uint8Array([1, 2]),
    date: new Date(1742925862000),
  };
  const copiedObj = copyOnWrite(obj);

  copiedObj.bytes[0] = 3;
  copiedObj.date.setTime(0);

  expect(copiedObj.bytes).toEqual(new Uint8Array([3, 2]));
  expect(copiedObj.date).toEqual(new Date(0));
  expect(obj.bytes).toEqual(new Uint8Array([1, 2]));
  expect(obj.date).toEqual(new Date(1742925862000));
});

test("copy timestamp", () => {
  const obj = {
    address: zeroAddress,
    timestamp: new Date(1742925862000),
  };

  const copiedObj = copy(obj);

  expect(copiedObj.timestamp).toBeInstanceOf(Date);
});
