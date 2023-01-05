import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { run } from "../src/index";

describe("create-ponder", () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = path.join(os.tmpdir(), "create-ponder-tests");
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  describe("run", () => {
    it.skip("works", async () => {
      await run({
        ponderRootDir: rootDir,
        etherscanApiKey: process.env.ETHERSCAN_API_KEY,
        fromEtherscan:
          "https://etherscan.io/address/0x9746fD0A77829E12F8A9DBe70D7a322412325B91",
      });

      console.log({ rootDir });

      expect(rootDir).toBe(rootDir);
    });
  });
});
