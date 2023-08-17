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
        expect(generated.sort()).toEqual(["index.ts", "schema.graphql"].sort());
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
        expect(generated.sort()).toEqual(["index.ts", "schema.graphql"].sort());
      });

      test("creates src files", async () => {
        const src = fs.readdirSync(path.join(rootDir, "src"));
        expect(src.sort()).toEqual(["Collector.ts"].sort());
      });
    });

    describe("mainnet EIP-1967 proxy (Zora)", () => {
      const rootDir = path.join(tmpDir, randomUUID());

      beforeAll(async () => {
        await run(
          {
            projectName: "proxy",
            rootDir,
            template: {
              kind: TemplateKind.ETHERSCAN,
              link: "https://etherscan.io/address/0x394997b586c925d90642e28899729f0f7cd36bdb", // zora
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

      test("downloads abis", async () => {
        const proxyAbiString = fs.readFileSync(
          path.join(rootDir, `abis/Zora1155.json`),
          { encoding: "utf8" }
        );
        expect(JSON.parse(proxyAbiString).length).toBeGreaterThan(0);

        const implementationAbiString = fs.readFileSync(
          path.join(rootDir, `abis/ZoraCreator1155Impl_0xd056.json`),
          { encoding: "utf8" }
        );
        expect(JSON.parse(implementationAbiString).length).toBeGreaterThan(0);
      });

      test("creates codegen files", async () => {
        const generated = fs.readdirSync(path.join(rootDir, "generated"));
        expect(generated.sort()).toEqual(["index.ts", "schema.graphql"].sort());
      });

      test("creates src files", async () => {
        const src = fs.readdirSync(path.join(rootDir, "src"));
        expect(src.sort()).toEqual(["Zora1155.ts"].sort());
      });
    });

    describe("mainnet EIP-1967 proxy (USDC)", () => {
      const rootDir = path.join(tmpDir, randomUUID());

      beforeAll(async () => {
        await run(
          {
            projectName: "usdc",
            rootDir,
            template: {
              kind: TemplateKind.ETHERSCAN,
              link: "https://etherscan.io/address/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
            },
          },
          {
            installCommand:
              'export npm_config_LOCKFILE=false ; pnpm --silent --filter "." install',
          }
        );
      });

      test("downloads abis", async () => {
        const proxyAbiString = fs.readFileSync(
          path.join(rootDir, `abis/FiatTokenProxy.json`),
          { encoding: "utf8" }
        );
        expect(JSON.parse(proxyAbiString).length).toBeGreaterThan(0);

        const implementationAbiString = fs.readFileSync(
          path.join(rootDir, `abis/FiatTokenV2_0xb727.json`),
          { encoding: "utf8" }
        );
        expect(JSON.parse(implementationAbiString).length).toBeGreaterThan(0);
      });
    });

    describe("zora EIP-1967 proxy (ZoraNFTCreatorProxy)", () => {
      const rootDir = path.join(tmpDir, randomUUID());

      beforeAll(async () => {
        await run(
          {
            projectName: "ZoraNFTCreatorProxy",
            rootDir,
            template: {
              kind: TemplateKind.ETHERSCAN,
              link: "https://explorer.zora.energy/address/0xA2c2A96A232113Dd4993E8b048EEbc3371AE8d85",
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

      test("downloads abis", async () => {
        const proxyAbiString = fs.readFileSync(
          path.join(rootDir, `abis/ZoraNFTCreatorProxy.json`),
          { encoding: "utf8" }
        );
        expect(JSON.parse(proxyAbiString).length).toBeGreaterThan(0);

        const implementationAbiString = fs.readFileSync(
          path.join(rootDir, `abis/ZoraNFTCreatorV1_0xe776.json`),
          { encoding: "utf8" }
        );
        expect(JSON.parse(implementationAbiString).length).toBeGreaterThan(0);
      });

      test("creates codegen files", async () => {
        const generated = fs.readdirSync(path.join(rootDir, "generated"));
        expect(generated.sort()).toEqual(["index.ts", "schema.graphql"].sort());
      });

      test("creates src files", async () => {
        const src = fs.readdirSync(path.join(rootDir, "src"));
        expect(src.sort()).toEqual(["ZoraNFTCreatorProxy.ts"].sort());
      });
    });

    describe("base BasePaint", () => {
      const rootDir = path.join(tmpDir, randomUUID());

      beforeAll(async () => {
        await run(
          {
            projectName: "BasePaint",
            rootDir,
            template: {
              kind: TemplateKind.ETHERSCAN,
              link: "https://basescan.org/address/0xba5e05cb26b78eda3a2f8e3b3814726305dcac83#code",
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

      test("downloads abis", async () => {
        const abiString = fs.readFileSync(
          path.join(rootDir, `abis/BasePaint.json`),
          { encoding: "utf8" }
        );
        expect(JSON.parse(abiString).length).toBeGreaterThan(0);
      });

      test("creates codegen files", async () => {
        const generated = fs.readdirSync(path.join(rootDir, "generated"));
        expect(generated.sort()).toEqual(["index.ts", "schema.graphql"].sort());
      });

      test("creates src files", async () => {
        const src = fs.readdirSync(path.join(rootDir, "src"));
        expect(src.sort()).toEqual(["BasePaint.ts"].sort());
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
        expect(generated.sort()).toEqual(["index.ts", "schema.graphql"].sort());
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
        expect(generated.sort()).toEqual(["index.ts", "schema.graphql"].sort());
      });

      test("creates src files", async () => {
        const src = fs.readdirSync(path.join(rootDir, "src"));
        expect(src).toEqual(["FiatTokenV1.ts"]);
      });
    });
  });

  describe("eslint", () => {
    const lintFileName = ".eslintrc.json";
    const ponderEslintConfig = "@ponder/eslint-config";

    test("installs eslint if enabled", async () => {
      const rootDir = path.join(tmpDir, randomUUID());
      await run(
        { rootDir, projectName: "eslint", eslint: true },
        { installCommand: 'echo "skip install"' }
      );

      const root = fs.readdirSync(rootDir);
      const packageJSON = JSON.parse(
        fs.readFileSync(path.join(rootDir, "package.json"), {
          encoding: "utf-8",
        })
      );

      expect(root).toContain(lintFileName);
      expect(packageJSON["scripts"]).toHaveProperty("lint");
      expect(packageJSON["devDependencies"]).toHaveProperty(ponderEslintConfig);
    });

    test("does not install eslint if disabled", async () => {
      const rootDir = path.join(tmpDir, randomUUID());
      await run(
        { rootDir, projectName: "eslint", eslint: false },
        { installCommand: 'echo "skip install"' }
      );

      const root = fs.readdirSync(rootDir);
      const packageJSON = JSON.parse(
        fs.readFileSync(path.join(rootDir, "package.json"), {
          encoding: "utf-8",
        })
      );

      expect(root).not.toContain(lintFileName);
      expect(packageJSON["scripts"]).not.toHaveProperty("lint");
      expect(packageJSON["devDependencies"]).not.toHaveProperty(
        ponderEslintConfig
      );
    });
  });
});
