import fs from "node:fs";
import { join } from "node:path";

import { afterEach, beforeAll, expect, test } from "vitest";

import { run } from "@/index.js";

const projectName = "test-app";
const genPath = join(__dirname, projectName);

beforeAll(() => fs.rmSync(genPath, { recursive: true, force: true }));
afterEach(() => fs.rmSync(genPath, { recursive: true, force: true }));

test("create empty", async () => {
  await run({
    args: [join("src", "_test", projectName)],
    options: { template: "empty", skipGit: true },
  });

  const templateFiles = fs
    .readdirSync(join(__dirname, "..", "..", "templates", "empty"))
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

  const generatedFiles = fs.readdirSync(genPath).sort();
  expect(templateFiles).toStrictEqual(generatedFiles);
});

test("create etherscan", async () => {
  await run({
    args: [join("src", "_test", projectName)],
    options: {
      template: "etherscan",
      skipGit: true,
      etherscanApiKey: process.env.ETHERSCAN_API_KEY!,
      etherscanContractLink:
        "https://etherscan.io/address/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    },
  });

  const templateFiles = (
    fs.readdirSync(join(__dirname, "..", "..", "templates", "etherscan"), {
      recursive: true,
    }) as string[]
  )
    .concat("ponder.config.ts")
    .concat("abis/WETH9Abi.ts")
    .concat("src/WETH9.ts")
    .concat("abis")
    .concat("src")
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

  const generatedFiles = fs.readdirSync(genPath, { recursive: true }).sort();
  expect(generatedFiles).toStrictEqual(templateFiles);
}, 20_000);
