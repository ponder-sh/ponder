import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { TemplateKind } from "@/common";
import { run } from "@/index";

const tmpDir = "../../tmp";

describe("create-ponder", () => {
  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("from etherscan", () => {
    describe("mainnet (ethfs)", () => {
      const rootDir = path.join(tmpDir, randomUUID());

      beforeAll(async () => {
        await run(
          {
            projectName: "ethfs",
            rootDir,
            template: {
              kind: TemplateKind.ETHERSCAN,
              link: "https://etherscan.io/address/0x9746fD0A77829E12F8A9DBe70D7a322412325B91", // ethfs
            },
          },
          {
            installCommand:
              'export npm_config_LOCKFILE=false ; pnpm --silent --filter "." install',
          }
        );
      });

      test("creates project files and directories", async () => {
        const root = fs.readdirSync(rootDir);
        expect(root).toContain(".env.local");
        expect(root).toContain(".gitignore");
        expect(root).toContain("abis");
        expect(root).toContain("generated");
        expect(root).toContain("src");
        expect(root).toContain("node_modules");
        expect(root).toContain("package.json");
        expect(root).toContain("ponder.config.ts");
        expect(root).toContain("schema.graphql");
        expect(root).toContain("tsconfig.json");
      });

      test("downloads abi", async () => {
        const abiString = fs.readFileSync(
          path.join(rootDir, `abis/FileStore.json`),
          { encoding: "utf8" }
        );
        const abi = JSON.parse(abiString);

        expect(abi.length).toBeGreaterThan(0);
      });

      test("creates codegen files", async () => {
        const generated = fs.readdirSync(path.join(rootDir, "generated"));
        expect(generated.sort()).toEqual(
          ["index.ts", "app.ts", "schema.graphql"].sort()
        );
      });

      test("creates src files", async () => {
        const src = fs.readdirSync(path.join(rootDir, "src"));
        expect(src.sort()).toEqual(["FileStore.ts"].sort());
      });
    });

    describe("goerli (collector)", () => {
      const rootDir = path.join(tmpDir, randomUUID());

      beforeAll(async () => {
        await run(
          {
            projectName: "goerli-faucet",
            rootDir,
            template: {
              kind: TemplateKind.ETHERSCAN,
              link: "https://goerli.etherscan.io/address/0xc638f625aC0369d56D55106affbD5b83872Db971", // faucet
            },
          },
          {
            installCommand:
              'export npm_config_LOCKFILE=false ; pnpm --silent --filter "." install',
          }
        );
      });

      test("creates project files and directories", async () => {
        const root = fs.readdirSync(rootDir);
        expect(root).toContain(".env.local");
        expect(root).toContain(".gitignore");
        expect(root).toContain("abis");
        expect(root).toContain("generated");
        expect(root).toContain("src");
        expect(root).toContain("node_modules");
        expect(root).toContain("package.json");
        expect(root).toContain("ponder.config.ts");
        expect(root).toContain("schema.graphql");
        expect(root).toContain("tsconfig.json");
      });

      test("downloads abi", async () => {
        const abiString = fs.readFileSync(
          path.join(rootDir, `abis/Collector.json`),
          { encoding: "utf8" }
        );
        const abi = JSON.parse(abiString);

        expect(abi.length).toBeGreaterThan(0);
      });

      test("creates codegen files", async () => {
        const generated = fs.readdirSync(path.join(rootDir, "generated"));
        expect(generated.sort()).toEqual(
          ["index.ts", "app.ts", "schema.graphql"].sort()
        );
      });

      test("creates src files", async () => {
        const src = fs.readdirSync(path.join(rootDir, "src"));
        expect(src.sort()).toEqual(["Collector.ts"].sort());
      });
    });
  });

  describe("from subgraph id", () => {
    describe("arbitrum (sentiment)", () => {
      const rootDir = path.join(tmpDir, randomUUID());

      beforeAll(async () => {
        await run(
          {
            projectName: "sentiment",
            rootDir,
            template: {
              kind: TemplateKind.SUBGRAPH_ID,
              id: "Qmd4tEQqAgLUV5SVBp2D92436N2PL8tD4svUz2XYcucKfM",
            },
          },
          {
            installCommand:
              'export npm_config_LOCKFILE=false ; pnpm --silent --filter "." install',
          }
        );
      });

      test("creates project files and directories", async () => {
        const root = fs.readdirSync(rootDir);
        expect(root).toContain(".env.local");
        expect(root).toContain(".gitignore");
        expect(root).toContain("abis");
        expect(root).toContain("generated");
        expect(root).toContain("src");
        expect(root).toContain("node_modules");
        expect(root).toContain("package.json");
        expect(root).toContain("ponder.config.ts");
        expect(root).toContain("schema.graphql");
        expect(root).toContain("tsconfig.json");
      });

      test("downloads abi", async () => {
        const abiString = fs.readFileSync(
          path.join(rootDir, `abis/LToken.json`),
          { encoding: "utf8" }
        );
        const abi = JSON.parse(abiString);

        expect(abi.length).toBeGreaterThan(0);
      });

      test("creates codegen files", async () => {
        const generated = fs.readdirSync(path.join(rootDir, "generated"));
        expect(generated.sort()).toEqual(
          ["index.ts", "app.ts", "schema.graphql"].sort()
        );
      });

      test("creates src files", async () => {
        const src = fs.readdirSync(path.join(rootDir, "src"));
        expect(src.sort()).toEqual(
          ["LETH.ts", "LFRAX.ts", "LUSDC.ts", "LUSDT.ts"].sort()
        );
      });
    });

    describe("usdc", () => {
      const rootDir = path.join(tmpDir, randomUUID());

      beforeAll(async () => {
        await run(
          {
            projectName: "usdc",
            rootDir,
            template: {
              kind: TemplateKind.SUBGRAPH_ID,
              id: "QmU5V3jy56KnFbxX2uZagvMwocYZASzy1inX828W2XWtTd",
            },
          },
          {
            installCommand:
              'export npm_config_LOCKFILE=false ; pnpm --silent --filter "." install',
          }
        );
      });

      test("creates project files and directories", async () => {
        const root = fs.readdirSync(rootDir);
        expect(root).toContain(".env.local");
        expect(root).toContain(".gitignore");
        expect(root).toContain("abis");
        expect(root).toContain("generated");
        expect(root).toContain("src");
        expect(root).toContain("node_modules");
        expect(root).toContain("package.json");
        expect(root).toContain("ponder.config.ts");
        expect(root).toContain("schema.graphql");
        expect(root).toContain("tsconfig.json");
      });

      test("downloads abi", async () => {
        const abiString = fs.readFileSync(
          path.join(rootDir, `abis/FiatTokenV1.json`),
          { encoding: "utf8" }
        );
        const abi = JSON.parse(abiString);

        expect(abi.length).toBeGreaterThan(0);
      });

      test("creates codegen files", async () => {
        const generated = fs.readdirSync(path.join(rootDir, "generated"));
        expect(generated.sort()).toEqual(
          ["index.ts", "app.ts", "schema.graphql"].sort()
        );
      });

      test("creates src files", async () => {
        const src = fs.readdirSync(path.join(rootDir, "src"));
        expect(src).toEqual(["FiatTokenV1.ts"]);
      });
    });
  });
});
