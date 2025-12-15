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
      path.join("abis", "ExampleContractAbi.ts"),
      path.join("src", "index.ts"),
      path.join("src", "api", "index.ts"),
    ]),
  );
});
