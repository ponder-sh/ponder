import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { watch } from "chokidar";
import { execa } from "execa";
import { glob } from "glob";
import pc from "picocolors";
import { rimraf } from "rimraf";

const PACKAGE_NAME = "@PONDER/CORE";

const TSCONFIG = "tsconfig.build.json";
const WATCH_DIRECTORY = "src";

const prefix = pc.gray(`[${PACKAGE_NAME}]`);
const log = {
  cli: (msg: string) => console.log(`${prefix} ${pc.magenta("CLI")} ${msg}`),
  error: (msg: string) => console.error(`${prefix} ${pc.red("ERROR")} ${msg}`),
  success: (msg: string) => console.log(`${prefix} ${pc.green("CLI")} ${msg}`),
  tsc: (msg: string) => console.log(`${prefix} ${pc.blue("TSC")} ${msg}`),
};

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

    const tscResult = await execa("tsc", ["--project", TSCONFIG], {
      reject: false,
      stderr: "pipe",
      stdout: "pipe",
    });

    `${tscResult.stdout}\n${tscResult.stderr}`
      .trim()
      .split("\n")
      .filter(Boolean)
      .forEach((line) => log.tsc(line));

    if (tscResult.exitCode !== 0) {
      log.error("Build failed");
      return false;
    } else {
      log.cli("Completed tsc without error");
    }

    const replacePathsResult = replaceAliasedPaths();
    if (replacePathsResult.error) {
      log.error(`Failed to replace import paths: ${replacePathsResult.error}`);
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

async function watchMode() {
  await build();

  const watcher = watch(WATCH_DIRECTORY, {
    cwd: path.dirname(fileURLToPath(import.meta.url)),
    persistent: true,
  });

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
    log.cli(`Watching for changes in "${WATCH_DIRECTORY}"`);
  });

  process.on("SIGINT", () => {
    watcher.close().then(() => {
      log.cli("Watch mode terminated");
      process.exit(0);
    });
  });
}

const importRegex = /from ['"](@\/[^'"]*)['"]/g;

function replaceAliasedPaths() {
  try {
    const directories = ["dist/esm", "dist/types"];

    for (const dir of directories) {
      let replacementCount = 0;

      // Normalize the directory path for the current OS
      const normalizedDir = path.normalize(dir);

      const filePaths = glob.sync(`${normalizedDir}/**/*`, { nodir: true });

      for (const filePath of filePaths) {
        const content = fs.readFileSync(filePath, "utf8");

        // Get the corresponding source path relative to src directory
        // Use posix-style paths for consistency in the relative path calculation
        const relativePath = path
          .relative(normalizedDir, filePath)
          // Convert Windows backslashes to forward slashes for consistency
          .split(path.sep)
          .join("/");

        const sourceFilePath = path.join("src", relativePath);
        // Ensure we use forward slashes for the source directory path
        const sourceFileDir = path
          .dirname(sourceFilePath)
          .split(path.sep)
          .join("/");

        // Replace all @/ imports with relative paths
        const newContent = content.replace(
          importRegex,
          (_match, importPath) => {
            // Remove @ prefix
            const importWithoutAlias = importPath.replace("@/", "");
            // Use forward slashes for the target path
            const targetPath = path
              .join("src", importWithoutAlias)
              .split(path.sep)
              .join("/");

            // Create relative path from the source file to the target
            // and ensure it uses forward slashes
            let relativePath = path
              .relative(sourceFileDir, targetPath)
              .split(path.sep)
              .join("/");

            // Ensure the path starts with ./ or ../
            if (!relativePath.startsWith(".")) {
              relativePath = `./${relativePath}`;
            }

            const replacementText = `from '${relativePath}'`;

            // Useful for debugging.
            // console.log({ file: filePath, old: _match, new: replacementText });

            replacementCount++;
            return replacementText;
          },
        );

        if (newContent !== content) {
          fs.writeFileSync(filePath, newContent);
        }
      }

      log.cli(
        `Replaced import paths in '${normalizedDir}' (${filePaths.length} files, ${replacementCount} replacements)`,
      );
    }

    return { error: null };
  } catch (e) {
    const error = e as Error;
    return { error };
  }
}
