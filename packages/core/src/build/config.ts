import { build } from "esbuild";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

import type { ResolvedConfig } from "@/config/types";
import { ensureDirExists } from "@/utils/exists";

export const buildConfig = async ({ configFile }: { configFile: string }) => {
  if (!existsSync(configFile)) {
    throw new Error(`Ponder config file not found, expected: ${configFile}`);
  }

  const buildFile = path.join(path.dirname(configFile), "__ponder__.js");
  ensureDirExists(buildFile);

  // Delete the build file before attempting to write it.
  rmSync(buildFile, { force: true });

  try {
    await build({
      entryPoints: [configFile],
      outfile: buildFile,
      platform: "node",
      format: "cjs",
      // Note: Flipped to true in order to be able to import external files into ponder.config.ts
      bundle: true,
      logLevel: "silent",
    });

    const { default: rawDefault, config: rawConfig } = require(buildFile);
    rmSync(buildFile, { force: true });

    if (!rawConfig) {
      if (rawDefault) {
        throw new Error(
          `Ponder config not found. ${path.basename(
            configFile
          )} must export a variable named "config" (Cannot be a default export)`
        );
      }
      throw new Error(
        `Ponder config not found. ${path.basename(
          configFile
        )} must export a variable named "config"`
      );
    }

    let resolvedConfig: ResolvedConfig;

    if (typeof rawConfig === "function") {
      resolvedConfig = await rawConfig();
    } else {
      resolvedConfig = await rawConfig;
    }

    return resolvedConfig;
  } catch (err) {
    rmSync(buildFile, { force: true });
    throw err;
  }
};
