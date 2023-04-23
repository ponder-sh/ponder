import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { buildAbi } from "./abi";

const abiSimple = [
  {
    inputs: [],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    inputs: [
      {
        indexed: true,
        type: "address",
      },
      {
        indexed: true,
        type: "address",
      },
      {
        indexed: false,
        type: "uint256",
      },
    ],
    name: "Transfer",
    type: "event",
  },
  {
    inputs: [
      {
        indexed: true,
        type: "address",
      },
      {
        indexed: true,
        type: "address",
      },
      {
        indexed: false,
        type: "uint256",
      },
    ],
    name: "Approve",
    type: "event",
  },
];

const abiDuplicateEvent = [
  {
    inputs: [],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    inputs: [
      {
        indexed: true,
        type: "address",
      },
      {
        indexed: true,
        type: "address",
      },
      {
        indexed: false,
        type: "uint256",
      },
    ],
    name: "Approve",
    type: "event",
  },
];

describe("buildAbi", () => {
  const tmpDir = path.join(tmpdir(), randomUUID());
  const configFilePath = path.join(tmpDir, "ponder.config.ts");

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("singular abi", () => {
    test("file path", () => {
      const abiSimplePath = path.join(tmpDir, "abiSimple.json");
      writeFileSync(abiSimplePath, JSON.stringify(abiSimple));

      const { abi, filePaths } = buildAbi({
        abiConfig: "./abiSimple.json",
        configFilePath,
      });

      expect(abi).toMatchObject(abiSimple);
      expect(filePaths).toMatchObject([abiSimplePath]);
    });

    test("object", () => {
      const { abi, filePaths } = buildAbi({
        abiConfig: abiSimple,
        configFilePath,
      });

      expect(abi).toMatchObject(abiSimple);
      expect(filePaths).toMatchObject([]);
    });
  });

  describe("array of abis", () => {
    test("single file path", () => {
      const abiSimplePath = path.join(tmpDir, "abiSimple.json");
      writeFileSync(abiSimplePath, JSON.stringify(abiSimple));

      const { abi, filePaths } = buildAbi({
        abiConfig: ["./abiSimple.json"],
        configFilePath,
      });

      expect(abi).toMatchObject(
        abiSimple.filter((x) => x.type !== "constructor")
      );
      expect(filePaths).toMatchObject([abiSimplePath]);
    });

    test("multiple file paths", () => {
      const abiSimplePath = path.join(tmpDir, "abiSimple.json");
      writeFileSync(abiSimplePath, JSON.stringify(abiSimple));
      const abiDuplicateEventPath = path.join(tmpDir, "abiDuplicateEvent.json");
      writeFileSync(abiDuplicateEventPath, JSON.stringify(abiDuplicateEvent));

      const { abi, filePaths } = buildAbi({
        abiConfig: ["./abiSimple.json", "./abiDuplicateEvent.json"],
        configFilePath,
      });

      expect(abi.filter((x) => x.type === "event")).toMatchObject(
        abiSimple.filter((x) => x.type === "event")
      );
      expect(filePaths).toMatchObject([abiSimplePath, abiDuplicateEventPath]);
    });

    test("one file path and one object, removes duplicate abi items", () => {
      const abiSimplePath = path.join(tmpDir, "abiSimple.json");
      writeFileSync(abiSimplePath, JSON.stringify(abiSimple));

      const { abi, filePaths } = buildAbi({
        abiConfig: ["./abiSimple.json", abiDuplicateEvent],
        configFilePath,
      });

      expect(abi.filter((x) => x.type === "event")).toMatchObject(
        abiSimple.filter((x) => x.type === "event")
      );
      expect(filePaths).toMatchObject([abiSimplePath]);
    });
  });
});
