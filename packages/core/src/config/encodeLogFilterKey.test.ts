import { describe, expect, test } from "vitest";

import {
  decodeLogFilterKey,
  encodeLogFilterKey,
  FilterAddress,
  FilterTopics,
} from "./encodeLogFilterKey";

describe("encodeLogFilterKey", () => {
  const chainId = 1;
  let address: FilterAddress = null;
  let topics: FilterTopics = null;

  describe("null address", () => {
    test("null topics", () => {
      address = null;
      topics = null;

      const options = { chainId, address, topics };
      const key = encodeLogFilterKey(options);
      expect(key).toBe("1-null-null");
      expect(decodeLogFilterKey({ key })).toMatchObject(options);
    });

    test("empty topics", () => {
      address = null;
      topics = [];

      const options = { chainId, address, topics };
      const key = encodeLogFilterKey(options);
      expect(key).toBe("1-null-[]");
      expect(decodeLogFilterKey({ key })).toMatchObject(options);
    });

    test("one topic, one value", () => {
      address = null;
      topics = ["0x1" as const];

      const options = { chainId, address, topics };
      const key = encodeLogFilterKey(options);
      expect(key).toBe('1-null-["0x1"]');
      expect(decodeLogFilterKey({ key })).toMatchObject(options);
    });

    test("one topic, multiple values", () => {
      address = null;
      topics = [["0x1" as const, "0x2" as const]];

      const options = { chainId, address, topics };
      const key = encodeLogFilterKey(options);
      expect(key).toBe('1-null-[["0x1","0x2"]]');
      expect(decodeLogFilterKey({ key })).toMatchObject(options);
    });

    test("multiple topics, one value", () => {
      address = null;
      topics = ["0x1" as const, "0x2" as const];

      const options = { chainId, address, topics };
      const key = encodeLogFilterKey(options);
      expect(key).toBe('1-null-["0x1","0x2"]');
      expect(decodeLogFilterKey({ key })).toMatchObject(options);
    });

    test("multiple topics, some multiple values", () => {
      address = null;
      topics = ["0x1" as const, ["0x2" as const, "0x3" as const]];

      const options = { chainId, address, topics };
      const key = encodeLogFilterKey(options);
      expect(key).toBe('1-null-["0x1",["0x2","0x3"]]');
      expect(decodeLogFilterKey({ key })).toMatchObject(options);
    });

    test("multiple topics, some null", () => {
      address = null;
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
      topics = null;

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
      topics = null;

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
