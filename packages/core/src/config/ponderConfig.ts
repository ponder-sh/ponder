import { build } from "esbuild";
import { existsSync, rmSync } from "node:fs";
import path from "path";
import { z } from "zod";

import { ensureDirExists } from "@/common/utils";
import type { PonderOptions } from "@/config/options";

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
      rpcUrl: z.optional(z.string()),
    })
  ),
  contracts: z.array(
    z.object({
      kind: z.optional(z.string()),
      name: z.string(),
      network: z.string(),
      abi: z.union([z.string(), z.array(z.any()), z.object({})]),
      address: z.string(),
      startBlock: z.optional(z.number()),
      endBlock: z.optional(z.number()),
      blockLimit: z.optional(z.number()),
      isIndexed: z.optional(z.boolean()),
    })
  ),
});

export type ResolvedPonderConfig = z.infer<typeof ponderConfigSchema>;

const ponderConfigBuilderSchema = z.union([
  ponderConfigSchema,
  z.promise(ponderConfigSchema),
  z.function().returns(ponderConfigSchema),
  z.function().returns(z.promise(ponderConfigSchema)),
]);

export type PonderConfig = z.infer<typeof ponderConfigBuilderSchema>;

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

    const { default: rawDefault, config: rawConfig } = require(buildFile);
    rmSync(buildFile, { force: true });

    if (!rawConfig) {
      if (rawDefault) {
        throw new Error(
          `Ponder config not found. ${path.basename(
            options.PONDER_CONFIG_FILE_PATH
          )} must export a variable named "config" (Cannot be a default export)`
        );
      }
      throw new Error(
        `Ponder config not found. ${path.basename(
          options.PONDER_CONFIG_FILE_PATH
        )} must export a variable named "config"`
      );
    }

    let resolvedConfig: ResolvedPonderConfig;

    if (typeof rawConfig === "function") {
      resolvedConfig = await rawConfig();
    } else {
      resolvedConfig = await rawConfig;
    }

    // TODO: Improve displaying errors zod schema errors, especially for common
    // issues like a missing RPC URL.
    const result = ponderConfigSchema.safeParse(resolvedConfig);
    if (!result.success) {
      throw new Error(
        `Invalid ponder config: ${JSON.stringify(
          result.error.flatten().fieldErrors,
          null,
          2
        )}`
      );
    }
    return result.data;
  } catch (err) {
    rmSync(buildFile, { force: true });
    throw err;
  }
};
