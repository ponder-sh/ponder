import fs from "node:fs";
import path from "node:path";

import { run } from "../src/index";

describe("create-ponder", () => {
  const tmpDir = "../../tmp";
  const rootDir = path.join(tmpDir, "create-ponder-tests");

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("run", () => {
    it("works", async () => {
      await run(
        {
          ponderRootDir: rootDir,
          fromEtherscan:
            "https://etherscan.io/address/0x9746fD0A77829E12F8A9DBe70D7a322412325B91",
        },
        {
          installCommand:
            'export npm_config_LOCKFILE=false ; pnpm --silent --filter "." install',
        }
      );

      expect(rootDir).toBe(rootDir);
    });
  });
});
