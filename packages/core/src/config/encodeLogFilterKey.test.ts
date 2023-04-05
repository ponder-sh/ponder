import { Address, Hex } from "viem";
import { describe, expect, test } from "vitest";

import { decodeLogFilterKey, encodeLogFilterKey } from "./encodeLogFilterKey";

describe("encodeLogFilterKey", () => {
  const chainId = 1;
  let address: Address | Address[] | undefined = undefined;
  let topics: (Hex | Hex[] | null)[] | undefined = undefined;

  describe("null address", () => {
    test("null topics", () => {
      address = undefined;
      topics = undefined;

      const options = { chainId, address, topics };
      const key = encodeLogFilterKey(options);
      expect(key).toBe("1-null-null");
      expect(decodeLogFilterKey({ key })).toMatchObject(options);
    });

    test("empty topics", () => {
      address = undefined;
      topics = [];

      const options = { chainId, address, topics };
      const key = encodeLogFilterKey(options);
      expect(key).toBe("1-null-[]");
      expect(decodeLogFilterKey({ key })).toMatchObject(options);
    });

    test("one topic, one value", () => {
      address = undefined;
      topics = ["0x1" as const];

      const options = { chainId, address, topics };
      const key = encodeLogFilterKey(options);
      expect(key).toBe('1-null-["0x1"]');
      expect(decodeLogFilterKey({ key })).toMatchObject(options);
    });

    test("one topic, multiple values", () => {
      address = undefined;
      topics = [["0x1" as const, "0x2" as const]];

      const options = { chainId, address, topics };
      const key = encodeLogFilterKey(options);
      expect(key).toBe('1-null-[["0x1","0x2"]]');
      expect(decodeLogFilterKey({ key })).toMatchObject(options);
    });

    test("multiple topics, one value", () => {
      address = undefined;
      topics = ["0x1" as const, "0x2" as const];

      const options = { chainId, address, topics };
      const key = encodeLogFilterKey(options);
      expect(key).toBe('1-null-["0x1","0x2"]');
      expect(decodeLogFilterKey({ key })).toMatchObject(options);
    });

    test("multiple topics, some multiple values", () => {
      address = undefined;
      topics = ["0x1" as const, ["0x2" as const, "0x3" as const]];

      const options = { chainId, address, topics };
      const key = encodeLogFilterKey(options);
      expect(key).toBe('1-null-["0x1",["0x2","0x3"]]');
      expect(decodeLogFilterKey({ key })).toMatchObject(options);
    });

    test("multiple topics, some null", () => {
      address = undefined;
      topics = ["0x1" as const, null, "0x3" as const];

      const options = { chainId, address, topics };
      const key = encodeLogFilterKey(options);
      expect(key).toBe('1-null-["0x1",null,"0x3"]');
      expect(decodeLogFilterKey({ key })).toMatchObject(options);
    });
  });

  describe("value address", () => {
    test("null topics", () => {
      address = "0xa" as const;
      topics = undefined;

      const options = { chainId, address, topics };
      const key = encodeLogFilterKey(options);
      expect(key).toBe('1-"0xa"-null');
      expect(decodeLogFilterKey({ key })).toMatchObject(options);
    });

    test("empty topics", () => {
      address = "0xa" as const;
      topics = [];

      const options = { chainId, address, topics };
      const key = encodeLogFilterKey(options);
      expect(key).toBe('1-"0xa"-[]');
      expect(decodeLogFilterKey({ key })).toMatchObject(options);
    });

    test("one topic, one value", () => {
      address = "0xa" as const;
      topics = ["0x1" as const];

      const options = { chainId, address, topics };
      const key = encodeLogFilterKey(options);
      expect(key).toBe('1-"0xa"-["0x1"]');
      expect(decodeLogFilterKey({ key })).toMatchObject(options);
    });

    test("one topic, multiple values", () => {
      address = "0xa" as const;
      topics = [["0x1" as const, "0x2" as const]];

      const options = { chainId, address, topics };
      const key = encodeLogFilterKey(options);
      expect(key).toBe('1-"0xa"-[["0x1","0x2"]]');
      expect(decodeLogFilterKey({ key })).toMatchObject(options);
    });

    test("multiple topics, one value", () => {
      address = "0xa" as const;
      topics = ["0x1" as const, "0x2" as const];

      const options = { chainId, address, topics };
      const key = encodeLogFilterKey(options);
      expect(key).toBe('1-"0xa"-["0x1","0x2"]');
      expect(decodeLogFilterKey({ key })).toMatchObject(options);
    });

    test("multiple topics, some multiple values", () => {
      address = "0xa" as const;
      topics = ["0x1" as const, ["0x2" as const, "0x3" as const]];

      const options = { chainId, address, topics };
      const key = encodeLogFilterKey(options);
      expect(key).toBe('1-"0xa"-["0x1",["0x2","0x3"]]');
      expect(decodeLogFilterKey({ key })).toMatchObject(options);
    });

    test("multiple topics, some null", () => {
      address = "0xa" as const;
      topics = ["0x1" as const, null, "0x3" as const];

      const options = { chainId, address, topics };
      const key = encodeLogFilterKey(options);
      expect(key).toBe('1-"0xa"-["0x1",null,"0x3"]');
      expect(decodeLogFilterKey({ key })).toMatchObject(options);
    });
  });

  describe("multiple address", () => {
    test("null topics", () => {
      address = ["0xa" as const, "0xb" as const];
      topics = undefined;

      const options = { chainId, address, topics };
      const key = encodeLogFilterKey(options);
      expect(key).toBe('1-["0xa","0xb"]-null');
      expect(decodeLogFilterKey({ key })).toMatchObject(options);
    });

    test("empty topics", () => {
      address = ["0xa" as const, "0xb" as const];
      topics = [];

      const options = { chainId, address, topics };
      const key = encodeLogFilterKey(options);
      expect(key).toBe('1-["0xa","0xb"]-[]');
      expect(decodeLogFilterKey({ key })).toMatchObject(options);
    });

    test("one topic, one value", () => {
      address = ["0xa" as const, "0xb" as const];
      topics = ["0x1" as const];

      const options = { chainId, address, topics };
      const key = encodeLogFilterKey(options);
      expect(key).toBe('1-["0xa","0xb"]-["0x1"]');
      expect(decodeLogFilterKey({ key })).toMatchObject(options);
    });

    test("one topic, multiple values", () => {
      address = ["0xa" as const, "0xb" as const];
      topics = [["0x1" as const, "0x2" as const]];

      const options = { chainId, address, topics };
      const key = encodeLogFilterKey(options);
      expect(key).toBe('1-["0xa","0xb"]-[["0x1","0x2"]]');
      expect(decodeLogFilterKey({ key })).toMatchObject(options);
    });

    test("multiple topics, one value", () => {
      address = ["0xa" as const, "0xb" as const];
      topics = ["0x1" as const, "0x2" as const];

      const options = { chainId, address, topics };
      const key = encodeLogFilterKey(options);
      expect(key).toBe('1-["0xa","0xb"]-["0x1","0x2"]');
      expect(decodeLogFilterKey({ key })).toMatchObject(options);
    });

    test("multiple topics, some multiple values", () => {
      address = ["0xa" as const, "0xb" as const];
      topics = ["0x1" as const, ["0x2" as const, "0x3" as const]];

      const options = { chainId, address, topics };
      const key = encodeLogFilterKey(options);
      expect(key).toBe('1-["0xa","0xb"]-["0x1",["0x2","0x3"]]');
      expect(decodeLogFilterKey({ key })).toMatchObject(options);
    });

    test("multiple topics, some null", () => {
      address = ["0xa" as const, "0xb" as const];
      topics = ["0x1" as const, null, "0x3" as const];

      const options = { chainId, address, topics };
      const key = encodeLogFilterKey(options);
      expect(key).toBe('1-["0xa","0xb"]-["0x1",null,"0x3"]');
      expect(decodeLogFilterKey({ key })).toMatchObject(options);
    });
  });
});
