import fs from "node:fs";
import path from "node:path";
import { watch } from "chokidar";
import { execa } from "execa";
import { glob } from "glob";
import pc from "picocolors";
import { rimraf } from "rimraf";

/**
 * Build script for `packages/core`. Must be run with Bun.
 *
 * - JavaScript: `Bun.build` transpiles every source file to the same relative path
 *   in `dist/esm` (one output per module, no bundling across files). `__DEBUG__` is
 *   defined as `false`, which removes debug assertions.
 * - Types: `tsc --emitDeclarationOnly` emits `dist/types`.
 */

const PACKAGE_NAME = "@PONDER/CORE";

const ROOT = import.meta.dir;
const TSCONFIG = "tsconfig.build.json";
const SRC = "src";
const OUT_ESM = "dist/esm";
const OUT_TYPES = "dist/types";
// Keep in sync with "exclude" in `tsconfig.build.json`.
const IGNORE = [
  "src/**/*.test.ts",
  "src/**/*.bench.ts",
  "src/**/*.test-d.ts",
  "src/**/*.d.ts",
  "src/_test/**",
];
const ASSERT_MODULE = path.join(ROOT, SRC, "utils", "assert.ts");

process.chdir(ROOT);

const prefix = pc.gray(`[${PACKAGE_NAME}]`);
const log = {
  cli: (msg: string) => console.log(`${prefix} ${pc.magenta("CLI")} ${msg}`),
  error: (msg: string) => console.error(`${prefix} ${pc.red("ERROR")} ${msg}`),
  success: (msg: string) => console.log(`${prefix} ${pc.green("CLI")} ${msg}`),
  tsc: (msg: string) => console.log(`${prefix} ${pc.blue("TSC")} ${msg}`),
  bun: (msg: string) => console.log(`${prefix} ${pc.yellow("BUN")} ${msg}`),
};

if (typeof Bun === "undefined") {
  log.error("build.ts must be run with Bun");
  process.exit(1);
}

const isWatchMode =
  process.argv.includes("--watch") || process.argv.includes("-w");

if (isWatchMode) {
  watchMode().catch((error) => {
    log.error(`Watch mode failed: ${error}`);
    process.exit(1);
  });
} else {
  build().then((success) => {
    process.exit(success ? 0 : 1);
  });
}

async function build() {
  try {
    log.cli("Build start");
    const startTime = Date.now();

    await rimraf("dist");
    log.cli("Cleaned output folder");

    const [jsSuccess, typesSuccess] = await Promise.all([
      buildJs(),
      buildTypes(),
    ]);
    if (!jsSuccess || !typesSuccess) {
      log.error("Build failed");
      return false;
    }

    // SQL files are loaded relative to the compiled module by migrations.
    fs.cpSync("src/sync-store/sql", "dist/esm/sync-store/sql", {
      recursive: true,
    });

    const checkResult = checkOutput();
    if (checkResult.error) {
      log.error(`Output check failed:\n${checkResult.error}`);
      return false;
    }

    const duration = Date.now() - startTime;
    log.success(`⚡️ Build success in ${duration}ms`);
    return true;
  } catch (error) {
    log.error(`Build failed: ${error}`);
    return false;
  }
}

/**
 * Source files that are emitted, as absolute paths.
 *
 * Note: The assert module is not emitted. It is only used in `if (__DEBUG__)`
 * blocks, which are removed. As an entrypoint, it would not be tree-shaken.
 */
function getEntrypoints() {
  return glob
    .sync(`${SRC}/**/*.ts`, { ignore: IGNORE, posix: true })
    .sort()
    .map((file) => path.resolve(file))
    .filter((file) => file !== ASSERT_MODULE);
}

/** Relative import specifier from the file `importer` to `target`, with forward slashes. */
function toRelativeSpecifier(importer: string, target: string) {
  let relativePath = path
    .relative(path.dirname(importer), target)
    .split(path.sep)
    .join("/");
  if (!relativePath.startsWith(".")) relativePath = `./${relativePath}`;
  return relativePath;
}

async function buildJs() {
  const startTime = Date.now();
  const entrypoints = getEntrypoints();

  const result = await Bun.build({
    entrypoints,
    root: SRC,
    outdir: OUT_ESM,
    target: "node",
    format: "esm",
    splitting: false,
    sourcemap: "linked",
    // Keep the output readable for stack traces. `if (false) { ... }` blocks
    // are removed without minification.
    minify: false,
    define: {
      __DEBUG__: "false",
      // Bun inlines `process.env.NODE_ENV` by default. Keep it a runtime value.
      "process.env.NODE_ENV": "process.env.NODE_ENV",
    },
    throw: false,
    plugins: [
      {
        name: "ponder-file-per-module",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) => {
            if (args.kind.startsWith("entry-point")) return undefined;

            const target = args.path.startsWith("@/")
              ? path.join(ROOT, SRC, args.path.slice(2))
              : args.path.startsWith(".")
                ? path.resolve(path.dirname(args.importer), args.path)
                : undefined;

            // Inline the assert module instead of importing it, so that it is
            // tree-shaken once every `if (__DEBUG__)` block is removed.
            // `checkOutput` fails the build if any reference survives.
            if (target?.replace(/\.js$/, ".ts") === ASSERT_MODULE) {
              return { path: ASSERT_MODULE };
            }

            // Every other import is external, so each module is emitted on its own.
            if (args.path.startsWith("@/")) {
              return {
                path: toRelativeSpecifier(args.importer, target!),
                external: true,
              };
            }
            return { path: args.path, external: true };
          });
        },
      },
    ],
  });

  for (const message of result.logs) log.bun(String(message));
  if (!result.success) return false;

  for (const entrypoint of entrypoints) {
    const outputPath = path.join(
      OUT_ESM,
      path.relative(SRC, entrypoint).replace(/\.ts$/, ".js"),
    );

    // Bun writes `sources` relative to `outdir` rather than to the sourcemap.
    // Also omit `sourcesContent` like `tsc` did, `src` is published.
    const sourcemapPath = `${outputPath}.map`;
    const sourcemap = JSON.parse(fs.readFileSync(sourcemapPath, "utf8"));
    sourcemap.sources = sourcemap.sources.map((source: string) =>
      toRelativeSpecifier(sourcemapPath, path.resolve(OUT_ESM, source)),
    );
    sourcemap.sourcesContent = undefined;
    fs.writeFileSync(sourcemapPath, JSON.stringify(sourcemap));

    // Bun drops comments. Restore magic comments in dynamic imports, such as
    // `import(/* webpackIgnore: true */ "node:fs")`, which keep bundlers from
    // resolving Node.js-only modules when apps import `ponder` in a frontend.
    const source = fs.readFileSync(entrypoint, "utf8");
    let output = fs.readFileSync(outputPath, "utf8");
    for (const [, comment, specifier] of source.matchAll(magicCommentRegex)) {
      const unannotated = `import("${specifier}")`;
      const annotated = `import(${comment} "${specifier}")`;
      if (output.includes(annotated)) continue;
      if (!output.includes(unannotated)) {
        log.error(
          `Failed to restore '${comment}' for '${specifier}' in '${outputPath}'`,
        );
        return false;
      }
      output = output.replaceAll(unannotated, annotated);
    }
    fs.writeFileSync(outputPath, output);
  }

  log.bun(
    `Transpiled ${entrypoints.length} files to '${OUT_ESM}' in ${Date.now() - startTime}ms`,
  );
  return true;
}

// Matches `import(/* comment */ "specifier")`.
const magicCommentRegex = /import\(\s*(\/\*[^*]*\*\/)\s*['"]([^'"]+)['"]\s*\)/g;

async function buildTypes() {
  const startTime = Date.now();
  const tscResult = await execa(
    "tsc",
    ["--project", TSCONFIG, "--emitDeclarationOnly"],
    { reject: false, stderr: "pipe", stdout: "pipe", preferLocal: true },
  );

  `${tscResult.stdout}\n${tscResult.stderr}`
    .trim()
    .split("\n")
    .filter(Boolean)
    .forEach((line) => {
      log.tsc(line);
    });

  if (tscResult.exitCode !== 0) return false;

  // Note: The assert module is not emitted, see `getEntrypoints`.
  await rimraf(path.join(OUT_TYPES, "utils", "assert.d.ts*"), { glob: true });
  log.tsc(
    `Emitted declarations to '${OUT_TYPES}' in ${Date.now() - startTime}ms`,
  );

  const replacePathsResult = replaceAliasedPaths(OUT_TYPES);
  if (replacePathsResult.error) {
    log.error(`Failed to replace import paths: ${replacePathsResult.error}`);
    return false;
  }
  return true;
}

// Matches `from "@/..."` and `import("@/...")`.
const aliasRegex = /(from |import\()(['"])(@\/[^'"]*)\2/g;

/** Rewrite `@/*` aliases in emitted declarations to relative paths. */
function replaceAliasedPaths(dir: string) {
  try {
    let replacementCount = 0;
    const filePaths = glob.sync(`${dir}/**/*.d.ts`, { nodir: true });

    for (const filePath of filePaths) {
      const content = fs.readFileSync(filePath, "utf8");

      // `dir` mirrors `src`, so resolve the alias against `dir`.
      const newContent = content.replace(
        aliasRegex,
        (_match, keyword: string, quote: string, importPath: string) => {
          replacementCount++;
          const target = path.resolve(dir, importPath.slice(2));
          return `${keyword}${quote}${toRelativeSpecifier(filePath, target)}${quote}`;
        },
      );

      if (newContent !== content) fs.writeFileSync(filePath, newContent);
    }

    log.cli(
      `Replaced import paths in '${dir}' (${filePaths.length} files, ${replacementCount} replacements)`,
    );

    return { error: null };
  } catch (e) {
    const error = e as Error;
    return { error };
  }
}

const unresolvedAliasRegex = /(from |import\()['"]@\//;

/**
 * Verify that every source file has an output, that debug assertions were
 * removed, and that no `@/*` aliases remain.
 */
function checkOutput() {
  const errors: string[] = [];

  const modules = getEntrypoints().map((file) =>
    path.relative(SRC, file).replace(/\.ts$/, ""),
  );
  for (const module of modules) {
    for (const output of [
      path.join(OUT_ESM, `${module}.js`),
      path.join(OUT_ESM, `${module}.js.map`),
      path.join(OUT_TYPES, `${module}.d.ts`),
    ]) {
      if (!fs.existsSync(output)) errors.push(`Missing '${output}'`);
    }

    const source = fs.readFileSync(path.join(SRC, `${module}.ts`), "utf8");
    const outputPath = path.join(OUT_ESM, `${module}.js`);
    if (
      source.includes("process.env.NODE_ENV") &&
      fs.existsSync(outputPath) &&
      !fs.readFileSync(outputPath, "utf8").includes("process.env.NODE_ENV")
    ) {
      errors.push(`'${outputPath}' inlined 'process.env.NODE_ENV'`);
    }
  }

  let hasAssertModule = false;
  for (const filePath of glob.sync(`${OUT_ESM}/**/*.js`, { nodir: true })) {
    const content = fs.readFileSync(filePath, "utf8");
    if (content.includes("__DEBUG__")) {
      errors.push(`'${filePath}' contains '__DEBUG__'`);
    }
    // Note: The assert module is inlined into every module that imports it
    // if any call survives, so report the modules with a call.
    if (/(?<!function )\bassert\(/.test(content)) {
      errors.push(
        `'${filePath}' calls 'assert()' outside of an 'if (__DEBUG__)' block`,
      );
    } else if (
      /utils\/assert\.(js|ts)['"]/.test(content) ||
      content.includes("AssertionError")
    ) {
      hasAssertModule = true;
    }
    if (unresolvedAliasRegex.test(content)) {
      errors.push(`'${filePath}' contains an unresolved '@/' import`);
    }
  }
  if (hasAssertModule && errors.length === 0) {
    errors.push(`'${OUT_ESM}' contains 'src/utils/assert.ts'`);
  }
  for (const filePath of glob.sync(`${OUT_TYPES}/**/*.d.ts`, { nodir: true })) {
    const content = fs.readFileSync(filePath, "utf8");
    if (unresolvedAliasRegex.test(content)) {
      errors.push(`'${filePath}' contains an unresolved '@/' import`);
    }
  }

  if (errors.length > 0) return { error: errors.join("\n") };
  log.cli(`Checked output (${modules.length} modules)`);
  return { error: null };
}

async function watchMode() {
  await build();

  const watcher = watch(SRC, { cwd: ROOT, persistent: true });

  let isBuilding = false;
  let isBuildQueued = false;

  async function enqueueBuild() {
    if (!isBuilding) {
      try {
        isBuilding = true;
        await build();
      } finally {
        isBuilding = false;
      }
      if (isBuildQueued) {
        isBuildQueued = false;
        await enqueueBuild();
      }
    } else {
      isBuildQueued = true;
    }
  }

  watcher.on("change", async (path) => {
    log.cli(`Change detected: ${path}`);
    await enqueueBuild();
  });

  watcher.on("error", (error) => {
    log.error(`Watch error: ${error}`);
  });

  watcher.on("ready", () => {
    log.cli(`Watching for changes in "${SRC}"`);
  });

  process.on("SIGINT", () => {
    watcher.close().then(() => {
      log.cli("Watch mode terminated");
      process.exit(0);
    });
  });
}
