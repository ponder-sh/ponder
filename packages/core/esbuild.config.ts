#!/usr/bin/env tsx
import esbuild, { type Plugin } from "esbuild";
import glob from "glob";
import childProcess from "node:child_process";
import fs from "node:fs";

import tsconfig from "./tsconfig.build.json" assert { type: "json" };

const tsconfigPath = "tsconfig.build.json";

const WATCH = process.argv.includes("--watch");

const buildFiles = glob.sync("src/**/*!(.test).@(ts|tsx)", {
  ignore: ["**/_test/**/*", "**/*.test.ts"],
});

const outFiles = buildFiles.map((file) =>
  file
    .replaceAll("src/", "dist/")
    .replaceAll(".ts", ".js")
    .replaceAll(".tsx", ".js")
    .replaceAll(".jsx", ".js")
);

type BuildOptions = Parameters<typeof esbuild.build>[0];

const buildOptions = {
  color: true,
  format: "esm",
  bundle: false,
  sourcemap: true,
  keepNames: true,
  outdir: "./dist",
  platform: "node",
  treeShaking: true,
  target: ["esnext"],
  tsconfig: tsconfigPath,
  entryPoints: buildFiles,
  plugins: [
    esbuildCleanPlugin({ outDir: tsconfig.compilerOptions.outDir }),
    esbuildDeclarationsPlugin({ tsconfigPath }),
    esbuildPathAliasPlugin(),
  ],
} satisfies BuildOptions;

if (!WATCH) {
  await esbuild.build(buildOptions).catch(() => process.exit(1));
  process.exit(0);
}

const context = await esbuild.context(buildOptions);

context
  .watch()
  .then(() => console.log("Watching for changes..."))
  .catch(() => process.exit(1));

/**
 * Plugins
 */

function esbuildCleanPlugin({ outDir }: { outDir: string }): Plugin {
  return {
    name: "esbuild-clean-plugin",
    setup: (build) =>
      build.onStart(() => {
        childProcess.execSync(`rm -rf ${outDir}`);
      }),
  };
}

function esbuildDeclarationsPlugin({
  tsconfigPath,
}: {
  tsconfigPath: string;
}): Plugin {
  return {
    name: "esbuild-declarations-plugin",
    setup: (build) =>
      build.onEnd((result) => {
        if (result.errors.length > 0) return console.error(result.errors);
        childProcess.execSync(
          `tsc --project ${tsconfigPath} --emitDeclarationOnly`
        );
      }),
  };
}

/**
 * As it stands right now, this assumes there's only one path alias and it's:
 * `{ "@/*": ["./src/*"] }`
 */
function esbuildPathAliasPlugin(): Plugin {
  return {
    name: "esbuild-path-alias-plugin",
    setup: (build) => {
      build.onEnd((result) => {
        if (result.errors.length > 0) {
          return console.error(
            "esbuild-path-alias-plugin error",
            result.errors
          );
        }
        outFiles.forEach((file) => {
          const content = fs.readFileSync(file, "utf-8");
          const aliasTransformation = content.replaceAll("@/", "#");
          return fs.writeFileSync(file, aliasTransformation);
        });
      });
    },
  };
}
