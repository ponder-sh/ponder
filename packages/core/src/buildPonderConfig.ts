import { build } from "esbuild";
import { existsSync, rmSync } from "node:fs";
import path from "path";
import { z } from "zod";

import type { PonderOptions } from "@/common/options";
import { ensureDirExists } from "@/common/utils";

const ponderConfigSchema = z.object({
  database: z.optional(
    z.union([
      z.object({ kind: z.literal("sqlite"), filename: z.string() }),
      z.object({ kind: z.literal("postgres"), connectionString: z.string() }),
    ])
  ),
  networks: z.array(
    z.object({
      kind: z.optional(z.string()),
      name: z.string(),
      chainId: z.number(),
      rpcUrl: z.string({
        required_error: "RPC URL is required",
      }),
    })
  ),
  sources: z.array(
    z.object({
      kind: z.optional(z.string()),
      name: z.string(),
      network: z.string(),
      abi: z.union([z.string(), z.array(z.any()), z.object({})]),
      address: z.string(),
      startBlock: z.optional(z.number()),
      blockLimit: z.optional(z.number()),
    })
  ),
  plugins: z.optional(z.array(z.function())),
});

export type PonderConfig = z.infer<typeof ponderConfigSchema>;

export const buildPonderConfig = async (options: PonderOptions) => {
  if (!existsSync(options.PONDER_CONFIG_FILE_PATH)) {
    throw new Error(
      `Ponder config file not found, expected: ${options.PONDER_CONFIG_FILE_PATH}`
    );
  }

  const buildFile = path.join(
    path.dirname(options.PONDER_DIR_PATH),
    "__ponder__.js"
  );
  ensureDirExists(buildFile);

  // Delete the build file before attempted to write it. This fixes a bug where a file
  // inside handlers/ gets renamed, the build fails, but the stale `handlers.js` file remains.
  rmSync(buildFile, { force: true });

  try {
    await build({
      entryPoints: [options.PONDER_CONFIG_FILE_PATH],
      outfile: buildFile,
      platform: "node",
      format: "cjs",
      bundle: false,
      logLevel: "silent",
    });

    let { default: rawConfig } = require(buildFile);
    rmSync(buildFile, { force: true });

    if (typeof rawConfig === "function") {
      rawConfig = await rawConfig();
    }

    // TODO: Improve displaying errors zod schema errors, especially for common
    // issues like a missing RPC URL.
    const config = ponderConfigSchema.parse(rawConfig);

    return config;
  } catch (err) {
    rmSync(buildFile, { force: true });
    throw err;
  }
};
