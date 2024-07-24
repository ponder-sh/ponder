import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "@/index.js";
import { rimrafSync } from "rimraf";
import { beforeEach, expect, test } from "vitest";

const tempDir = path.join(os.tmpdir(), randomUUID());

beforeEach(() => {
  mkdirSync(tempDir, { recursive: true });
  return () => rimrafSync(tempDir);
});

test("create empty", async () => {
  const rootDir = path.join(tempDir, "empty");

  await run({
    args: [rootDir],
    options: { template: "empty", skipGit: true, skipInstall: true },
  });

  const files = readdirSync(rootDir, { recursive: true, encoding: "utf8" });

  expect(files).toEqual(
    expect.arrayContaining([
      ".env.local",
      ".eslintrc.json",
      ".gitignore",
      "package.json",
      "ponder-env.d.ts",
      "ponder.config.ts",
      "ponder.schema.ts",
      "tsconfig.json",
      "abis/ExampleContractAbi.ts",
      "src/index.ts",
      "src/api/index.ts",
    ]),
  );
});

test("create subgraph thegraph", async () => {
  const rootDir = path.join(tempDir, "subgraph-id");

  await run({
    args: [rootDir],
    options: {
      template: "subgraph",
      subgraph: "QmeCy8bjyudQYwddetkgKDKQTsFxWomvbgsDifnbWFEMK9",
      subgraphProvider: "thegraph",
      skipGit: true,
      skipInstall: true,
    },
  });

  const files = readdirSync(rootDir, { recursive: true, encoding: "utf8" });

  expect(files).toEqual(
    expect.arrayContaining([
      ".env.local",
      ".eslintrc.json",
      ".gitignore",
      "package.json",
      "ponder-env.d.ts",
      "ponder.config.ts",
      "ponder.schema.ts",
      "tsconfig.json",
      "abis/ERC20Abi.ts",
      "abis/ERC721Abi.ts",
      "abis/EntryPointAbi.ts",
      "src/EntryPoint.ts",
      "src/EntryPointV0.6.0.ts",
    ]),
  );
});

test("create subgraph satsuma", async () => {
  const rootDir = path.join(tempDir, "subgraph-id");

  await run({
    args: [rootDir],
    options: {
      template: "subgraph",
      subgraph: "QmbjiXHX5E7VypxH2gRcdySEXsvSUo7Aocuypr7m9u6Na9",
      subgraphProvider: "satsuma",
      skipGit: true,
      skipInstall: true,
    },
  });

  const files = readdirSync(rootDir, { recursive: true, encoding: "utf8" });

  expect(files).toEqual(
    expect.arrayContaining([
      ".env.local",
      ".eslintrc.json",
      ".gitignore",
      "package.json",
      "ponder-env.d.ts",
      "ponder.config.ts",
      "ponder.schema.ts",
      "tsconfig.json",
      "abis/AchievementNFTAbi.ts",
      "src/AchievementNFT.ts",
    ]),
  );
});

test("create etherscan", async () => {
  const rootDir = path.join(tempDir, "etherscan");

  await run({
    args: [rootDir],
    options: {
      template: "etherscan",
      etherscanApiKey: process.env.ETHERSCAN_API_KEY!,
      etherscan:
        "https://etherscan.io/address/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      skipGit: true,
      skipInstall: true,
    },
  });

  const files = readdirSync(rootDir, { recursive: true, encoding: "utf8" });

  console.log(files);

  expect(files).toEqual(
    expect.arrayContaining([
      ".env.local",
      ".eslintrc.json",
      ".gitignore",
      "package.json",
      "ponder-env.d.ts",
      "ponder.config.ts",
      "ponder.schema.ts",
      "tsconfig.json",
      expect.stringMatching(/src\/(?:WETH9|UnverifiedContract)\.ts/),
      expect.stringMatching(/abis\/(?:WETH9|UnverifiedContract)Abi\.ts/),
    ]),
  );
});
