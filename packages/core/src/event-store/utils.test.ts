import { expect, test } from "vitest";

import { bigIntToBlob, blobToBigInt } from "./utils";

test("bigIntToBlob handles small positive integer", () => {
  const uint = 101n;

  const blob = bigIntToBlob(uint);
  expect(blob.length).toBe(33);
  expect(blobToBigInt(blob)).toBe(uint);
});

test("bigIntToBlob handles max positive integer", () => {
  const uint =
    115792089237316195423570985008687907853269984665640564039457584007913129639935n;

  const blob = bigIntToBlob(uint);
  expect(blob.length).toBe(33);
  expect(blobToBigInt(blob)).toBe(uint);
});

test("bigIntToBlob handles small negative int", () => {
  const uint = -255n;

  const blob = bigIntToBlob(uint);
  expect(blob.length).toBe(33);
  expect(blobToBigInt(blob)).toBe(uint);
});

test("bigIntToBlob handles max negative int", () => {
  const uint =
    -57896044618658097711785492504343953926634992332820282019728792003956564819968n;

  const blob = bigIntToBlob(uint);
  expect(blob.length).toBe(33);
  expect(blobToBigInt(blob)).toBe(uint);
});
