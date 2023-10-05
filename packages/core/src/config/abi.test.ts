import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, expect, test } from "vitest";

import { buildAbi, getEvents } from "./abi.js";

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
] as const;

const abiWithSameEvent = [
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
] as const;

let tmpDir: string;
let configFilePath: string;

beforeEach(() => {
  tmpDir = path.join(tmpdir(), randomUUID());
  configFilePath = path.join(tmpDir, "ponder.config.ts");

  mkdirSync(tmpDir, { recursive: true });

  return () => rmSync(tmpDir, { recursive: true, force: true });
});

test("buildAbi handles a single ABI passed as a file path", () => {
  const abiSimplePath = path.join(tmpDir, "abiSimple.json");
  writeFileSync(abiSimplePath, JSON.stringify(abiSimple));

  const { abi, filePaths } = buildAbi({
    abiConfig: "./abiSimple.json.js",
    configFilePath,
  });

  expect(abi).toMatchObject(abiSimple);
  expect(filePaths).toMatchObject([abiSimplePath]);
});

test("buildAbi handles a single ABI passed as an object", () => {
  const { abi, filePaths } = buildAbi({
    abiConfig: abiSimple,
    configFilePath,
  });

  expect(abi).toMatchObject(abiSimple);
  expect(filePaths).toMatchObject([]);
});

test("buildAbi handles an array with a single ABI passed as a file path", () => {
  const abiSimplePath = path.join(tmpDir, "abiSimple.json");
  writeFileSync(abiSimplePath, JSON.stringify(abiSimple));

  const { abi, filePaths } = buildAbi({
    abiConfig: ["./abiSimple.json.js"],
    configFilePath,
  });

  expect(abi).toMatchObject(abiSimple.filter((x) => x.type !== "constructor"));
  expect(filePaths).toMatchObject([abiSimplePath]);
});

test("buildAbi handles an array of ABIs passed as file paths", () => {
  const abiSimplePath = path.join(tmpDir, "abiSimple.json");
  writeFileSync(abiSimplePath, JSON.stringify(abiSimple));
  const abiWithSameEventPath = path.join(tmpDir, "abiWithSameEvent.json");
  writeFileSync(abiWithSameEventPath, JSON.stringify(abiWithSameEvent));

  const { abi, filePaths } = buildAbi({
    abiConfig: ["./abiSimple.json.js", "./abiWithSameEvent.json.js"],
    configFilePath,
  });

  expect(abi.filter((x) => x.type === "event")).toMatchObject(
    abiSimple.filter((x) => x.type === "event")
  );
  expect(filePaths).toMatchObject([abiSimplePath, abiWithSameEventPath]);
});

test("buildAbi handles an array of ABIs with both file paths and objects", () => {
  const abiSimplePath = path.join(tmpDir, "abiSimple.json");
  writeFileSync(abiSimplePath, JSON.stringify(abiSimple));

  const { abi, filePaths } = buildAbi({
    abiConfig: ["./abiSimple.json.js", abiWithSameEvent],
    configFilePath,
  });

  expect(abi.filter((x) => x.type === "event")).toMatchObject(
    abiSimple.filter((x) => x.type === "event")
  );
  expect(filePaths).toMatchObject([abiSimplePath]);
});

test("buildAbi handles an array of ABIs and removes duplicate abi items", () => {
  const abiSimplePath = path.join(tmpDir, "abiSimple.json");
  writeFileSync(abiSimplePath, JSON.stringify(abiSimple));

  const { abi, filePaths } = buildAbi({
    abiConfig: ["./abiSimple.json.js", abiWithSameEvent],
    configFilePath,
  });

  expect(abi.filter((x) => x.type === "event")).toMatchObject(
    abiSimple.filter((x) => x.type === "event")
  );
  expect(filePaths).toMatchObject([abiSimplePath]);
});

const abiWithOverloadedEvents = [
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
        type: "uint8",
      },
      {
        indexed: true,
        type: "uint256",
      },
      {
        indexed: false,
        type: "uint256",
      },
      {
        indexed: false,
        type: "address",
      },
    ],
    name: "Transfer",
    type: "event",
  },
] as const;

test("getEvents handles overloaded events", () => {
  const events = getEvents({ abi: abiWithOverloadedEvents });

  expect(events).toMatchObject({
    "Transfer(address indexed, address indexed, uint256)": {
      safeName: "Transfer(address indexed, address indexed, uint256)",
      signature: "event Transfer(address indexed, address indexed, uint256)",
      selector:
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      abiItem: {
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
    },
    "Transfer(uint8 indexed, uint256 indexed, uint256, address)": {
      safeName: "Transfer(uint8 indexed, uint256 indexed, uint256, address)",
      signature:
        "event Transfer(uint8 indexed, uint256 indexed, uint256, address)",
      selector:
        "0x7d80b356169a1ce57762f79d1bc650835653d9798678ef3691964dfcde65cd76",
      abiItem: {
        inputs: [
          {
            indexed: true,
            type: "uint8",
          },
          {
            indexed: true,
            type: "uint256",
          },
          {
            indexed: false,
            type: "uint256",
          },
          {
            indexed: false,
            type: "address",
          },
        ],
        name: "Transfer",
        type: "event",
      },
    },
  });
});
