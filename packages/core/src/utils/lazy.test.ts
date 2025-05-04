import { expect, test } from "vitest";
import { lazyChecksumAddress, lazyCopy } from "./lazy.js";

test("lazyChecksumAddress object", () => {
  const lazyObj = lazyChecksumAddress(
    {
      address: "0x4838b106fce9647bdf1e7877bf73ce8b0bad5f97",
    },
    "address",
  );

  expect(lazyObj.address).toBe("0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97");
});

test("lazyChecksumAddress array", () => {
  const obj = ["0x4838b106fce9647bdf1e7877bf73ce8b0bad5f97"];

  const lazyObj = lazyChecksumAddress(obj, 0);

  expect(lazyObj[0]).toBe("0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97");
});

test("lazyCopy()", () => {
  const row = {
    address: "0x4838b106fce9647bdf1e7877bf73ce8b0bad5f97",
    balance: 10n,
  };

  const lazyRow = lazyCopy(row);

  expect(row.balance).toBe(10n);
  expect(lazyRow.balance).toBe(10n);

  lazyRow.balance = 11n;

  expect(row.balance).toBe(10n);
  expect(lazyRow.balance).toBe(11n);
});
