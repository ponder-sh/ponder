import fs from "node:fs";
import path from "node:path";

import { run } from "../src/index";

const tmpDir = "../../tmp";

describe("create-ponder", () => {
  describe("from etherscan", () => {
    describe("mainnet", () => {
      const rootDir = path.join(tmpDir, "create-ponder-tests-mainnet");

      beforeAll(async () => {
        await run(
          {
            ponderRootDir: rootDir,
            fromEtherscan:
              "https://etherscan.io/address/0x9746fD0A77829E12F8A9DBe70D7a322412325B91", // ethfs
          },
          {
            installCommand:
              'export npm_config_LOCKFILE=false ; pnpm --silent --filter "." install',
          }
        );
      });

      afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      });

      it("creates project files and directories", async () => {
        const root = fs.readdirSync(rootDir);
        expect(root.sort()).toEqual(
          [
            ".env.local",
            ".gitignore",
            ".ponder",
            "abis",
            "generated",
            "handlers",
            "node_modules",
            "package.json",
            "ponder.ts",
            "schema.graphql",
            "tsconfig.json",
          ].sort()
        );
      });

      it("downloads abi", async () => {
        const abiString = fs.readFileSync(
          path.join(rootDir, `abis/FileStore.json`),
          { encoding: "utf8" }
        );
        const abi = JSON.parse(abiString);

        expect(abi.length).toBeGreaterThan(0);
      });

      it("creates codegen files", async () => {
        const generated = fs.readdirSync(path.join(rootDir, "generated"));
        expect(generated.sort()).toEqual(["handlers.ts", "contracts"].sort());

        const contracts = fs.readdirSync(
          path.join(rootDir, "generated/contracts")
        );
        expect(contracts.sort()).toEqual(["FileStore.ts"].sort());
      });
    });

    describe("goerli", () => {
      const rootDir = path.join(tmpDir, "create-ponder-tests-goerli");

      beforeAll(async () => {
        await run(
          {
            ponderRootDir: rootDir,
            fromEtherscan:
              "https://goerli.etherscan.io/address/0xc638f625aC0369d56D55106affbD5b83872Db971", // faucet
          },
          {
            installCommand:
              'export npm_config_LOCKFILE=false ; pnpm --silent --filter "." install',
          }
        );
      });

      afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      });

      it("creates project files and directories", async () => {
        const root = fs.readdirSync(rootDir);
        expect(root.sort()).toEqual(
          [
            ".env.local",
            ".gitignore",
            ".ponder",
            "abis",
            "generated",
            "handlers",
            "node_modules",
            "package.json",
            "ponder.ts",
            "schema.graphql",
            "tsconfig.json",
          ].sort()
        );
      });

      it("downloads abi", async () => {
        const abiString = fs.readFileSync(
          path.join(rootDir, `abis/Collector.json`),
          { encoding: "utf8" }
        );
        const abi = JSON.parse(abiString);

        expect(abi.length).toBeGreaterThan(0);
      });

      it("creates codegen files", async () => {
        const generated = fs.readdirSync(path.join(rootDir, "generated"));
        expect(generated.sort()).toEqual(["handlers.ts", "contracts"].sort());

        const contracts = fs.readdirSync(
          path.join(rootDir, "generated/contracts")
        );
        expect(contracts.sort()).toEqual(["Collector.ts"].sort());
      });
    });
  });
});
