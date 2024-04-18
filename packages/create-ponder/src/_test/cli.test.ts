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
    options: { template: "empty", skipGit: true },
  });

  const templateFiles = (
    readdirSync(
      path.join(__dirname, "..", "..", "templates", "empty"),
    ) as string[]
  )
    .concat(["abis/ExampleContractAbi.ts", "src/index.ts"])
    .map((filePath) =>
      filePath === "_dot_env.local"
        ? ".env.local"
        : filePath === "_dot_eslintrc.json"
          ? ".eslintrc.json"
          : filePath === "_dot_gitignore"
            ? ".gitignore"
            : filePath,
    )
    .sort();

  const generatedFiles = (readdirSync(rootDir, { recursive: true }) as string[])
    .filter((f) => !f.startsWith("node_modules") && !f.startsWith("pnpm-lock"))
    .sort();
  expect(generatedFiles).toStrictEqual(templateFiles);
});

test("create subgraph id", async () => {
  const rootDir = path.join(tempDir, "subgraph-id");

  await run({
    args: [rootDir],
    options: {
      template: "subgraph",
      skipGit: true,
      subgraph: "QmeCy8bjyudQYwddetkgKDKQTsFxWomvbgsDifnbWFEMK9",
    },
  });

  const templateFiles = (
    readdirSync(path.join(__dirname, "..", "..", "templates", "subgraph"), {
      recursive: true,
    }) as string[]
  )
    .concat([
      "ponder.config.ts",
      "abis/ERC20Abi.ts",
      "abis/ERC721Abi.ts",
      "abis/EntryPointAbi.ts",
      "src/EntryPoint.ts",
      "src/EntryPointV0.6.0.ts",
      "abis",
      "src",
    ])
    // _gitignore is renamed to .gitignore
    .map((filePath) =>
      filePath === "_dot_env.local"
        ? ".env.local"
        : filePath === "_dot_eslintrc.json"
          ? ".eslintrc.json"
          : filePath === "_dot_gitignore"
            ? ".gitignore"
            : filePath,
    )
    .sort();

  const generatedFiles = (readdirSync(rootDir, { recursive: true }) as string[])
    .filter((f) => !f.startsWith("node_modules") && !f.startsWith("pnpm-lock"))
    .sort();
  expect(generatedFiles).toStrictEqual(templateFiles);
});

test("create etherscan", async () => {
  const rootDir = path.join(tempDir, "etherscan");

  await run({
    args: [rootDir],
    options: {
      template: "etherscan",
      skipGit: true,
      etherscanApiKey: process.env.ETHERSCAN_API_KEY!,
      etherscan:
        "https://etherscan.io/address/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    },
  });

  const templateFiles = (
    readdirSync(path.join(__dirname, "..", "..", "templates", "etherscan"), {
      recursive: true,
    }) as string[]
  )
    .concat([
      "ponder.config.ts",
      "abis/WETH9Abi.ts",
      "src/WETH9.ts",
      "abis",
      "src",
    ])
    // _gitignore is renamed to .gitignore
    .map((filePath) =>
      filePath === "_dot_env.local"
        ? ".env.local"
        : filePath === "_dot_eslintrc.json"
          ? ".eslintrc.json"
          : filePath === "_dot_gitignore"
            ? ".gitignore"
            : filePath,
    )
    .sort();

  const generatedFiles = (readdirSync(rootDir, { recursive: true }) as string[])
    .filter((f) => !f.startsWith("node_modules") && !f.startsWith("pnpm-lock"))
    .sort();
  expect(generatedFiles).toStrictEqual(templateFiles);
});
