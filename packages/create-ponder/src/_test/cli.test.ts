import { join } from "node:path";

import fs from "fs-extra";
import { afterEach, beforeAll, expect, test } from "vitest";

import { run } from "@/index.js";

const projectName = "test-app";
const genPath = join(__dirname, projectName);

beforeAll(async () => await fs.remove(genPath));
afterEach(async () => await fs.remove(genPath));

test("create default", async () => {
  await run({
    args: [join("src", "_test", projectName)],
    options: { template: "default", skipGit: true },
  });

  const templateFiles = fs
    .readdirSync(join(__dirname, "..", "..", "templates", "default"))
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
  expect(templateFiles).toEqual(generatedFiles);
});

test("create etherscan", async () => {
  await run({
    args: [join("src", "_test", projectName)],
    options: {
      template: "etherscan",
      skipGit: true,
      etherscanApiKey: process.env.ETHERSCAN_API_KEY!,
      etherscanContractLink:
        "https://etherscan.io/address/0x42CDc5D4B05E8dACc2FCD181cbe0Cc86Ee14c439",
    },
  });

  const templateFiles = fs
    .readdirSync(join(__dirname, "..", "..", "templates", "etherscan"))
    .concat("ponder.config.ts")
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
  expect(templateFiles).toEqual(generatedFiles);
}, 30_000);
