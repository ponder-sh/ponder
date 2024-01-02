import { expect, test } from "vitest";

import {
  EVM_MAX_UINT,
  EVM_MIN_INT,
  decodeToBigInt,
  encodeAsText,
} from "./encoding.js";

test("encodeAsText handles small positive integer", () => {
  const value = 101n;

  const encoded = encodeAsText(value);
  expect(encoded).toBe(
    "0000000000000000000000000000000000000000000000000000000000000000000000000000101",
  );
  expect(decodeToBigInt(encoded)).toBe(value);
});

test("encodeAsText handles max positive integer", () => {
  const value = EVM_MAX_UINT;

  const encoded = encodeAsText(value);
  expect(encoded).toBe(
    "0115792089237316195423570985008687907853269984665640564039457584007913129639935",
  );
  expect(decodeToBigInt(encoded)).toBe(value);
});

test("encodeAsText throws if value is less than max negative int", () => {
  const value = EVM_MAX_UINT + 1n;

  expect(() => encodeAsText(value)).toThrow(
    "Value cannot be greater than EVM_MAX_UINT (115792089237316195423570985008687907853269984665640564039457584007913129639936)",
  );
});

test("encodeAsText handles small negative int", () => {
  const value = -255n;

  const encoded = encodeAsText(value);
  expect(encoded).toBe(
    "-057896044618658097711785492504343953926634992332820282019728792003956564819713",
  );
  expect(decodeToBigInt(encoded)).toBe(value);
});

test("encodeAsText handles max negative int", () => {
  const value = EVM_MIN_INT;

  const encoded = encodeAsText(value);
  expect(encoded).toBe(
    "-000000000000000000000000000000000000000000000000000000000000000000000000000000",
  );
  expect(decodeToBigInt(encoded)).toBe(value);
});

test("encodeAsText throws if value is less than max negative int", () => {
  const value = EVM_MIN_INT - 1n;

  expect(() => encodeAsText(value)).toThrow(
    "Value cannot be less than EVM_MIN_INT (-57896044618658097711785492504343953926634992332820282019728792003956564819969)",
  );
});

test("encodeAsText handles zero", () => {
  const value = 0n;

  const encoded = encodeAsText(value);
  expect(encoded).toBe(
    "0000000000000000000000000000000000000000000000000000000000000000000000000000000",
  );
  expect(decodeToBigInt(encoded)).toBe(value);
});

test("lexicographic sort works as expected", () => {
  const values = [
    EVM_MAX_UINT,
    0n,
    EVM_MIN_INT,
    EVM_MAX_UINT - 1n,
    1_000n,
    -500n,
    EVM_MIN_INT + 1n,
  ];

  const encoded = values.map(encodeAsText);
  const sorted = encoded.slice().sort();
  const decoded = sorted.map(decodeToBigInt);

  expect(decoded).toMatchObject([
    EVM_MIN_INT,
    EVM_MIN_INT + 1n,
    -500n,
    0n,
    1_000n,
    EVM_MAX_UINT - 1n,
    EVM_MAX_UINT,
  ]);
});
