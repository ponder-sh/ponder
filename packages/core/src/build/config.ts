import { build, Plugin } from "esbuild";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

import type { ResolvedConfig } from "@/config/config";
import { ensureDirExists } from "@/utils/exists";

/**
 * Fixes issue with createConfig() being built
 *
 * {@link} https://github.com/evanw/esbuild/issues/1051
 */
const nativeNodeModulesPlugin: Plugin = {
  name: "native-node-modules",
  setup(build) {
    // If a ".node" file is imported within a module in the "file" namespace, resolve
    // it to an absolute path and put it into the "node-file" virtual namespace.
    build.onResolve({ filter: /\.node$/, namespace: "file" }, (args) => ({
      path: require.resolve(args.path, { paths: [args.resolveDir] }),
      namespace: "node-file",
    }));

    // Files in the "node-file" virtual namespace call "require()" on the
    // path from esbuild of the ".node" file in the output directory.
    build.onLoad({ filter: /.*/, namespace: "node-file" }, (args) => ({
      contents: `
        import path from ${JSON.stringify(args.path)}
        try { module.exports = require(path) }
        catch {}
      `,
    }));

    // If a ".node" file is imported within a module in the "node-file" namespace, put
    // it in the "file" namespace where esbuild's default loading behavior will handle
    // it. It is already an absolute path since we resolved it to one above.
    build.onResolve({ filter: /\.node$/, namespace: "node-file" }, (args) => ({
      path: args.path,
      namespace: "file",
    }));

    // Tell esbuild's default loading behavior to use the "file" loader for
    // these ".node" files.
    const opts = build.initialOptions;
    opts.loader = opts.loader || {};
    opts.loader[".node"] = "file";
  },
};

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
      plugins: [nativeNodeModulesPlugin],
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
