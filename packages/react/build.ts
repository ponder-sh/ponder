/// <reference types="node" />

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { watch } from "chokidar";
import { execa } from "execa";
import { rimraf } from "rimraf";

const PACKAGE_NAME = "@PONDER/REACT";

const TSCONFIG = "tsconfig.build.json";
const WATCH_DIRECTORY = "src";

// Logging utilities
const prefix = chalk.gray(`[${PACKAGE_NAME}]`);
const log = {
  cli: (msg: string) => console.log(`${prefix} ${chalk.magenta("CLI")} ${msg}`),
  error: (msg: string) =>
    console.error(`${prefix} ${chalk.red("ERROR")} ${msg}`),
  success: (msg: string) =>
    console.log(`${prefix} ${chalk.green("CLI")} ${msg}`),
  tsc: (msg: string) => console.log(`${prefix} ${chalk.blue("TSC")} ${msg}`),
};

async function build() {
  try {
    log.cli("Build start");
    const startTime = Date.now();

    // Clean dist folder
    await rimraf("dist");
    log.cli("Cleaned output folder");

    // Run TypeScript compiler
    const result = await execa("tsc", ["--project", TSCONFIG], {
      reject: false,
      stderr: "pipe",
      stdout: "pipe",
    });

    // Handle compiler output
    const output = `${result.stdout}\n${result.stderr}`
      .trim()
      .split("\n")
      .filter(Boolean);

    output.forEach((line) => log.tsc(line));

    if (result.exitCode !== 0) {
      log.error("Build failed");
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
    cwd: dirname(fileURLToPath(import.meta.url)),
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

  // Handle process termination
  process.on("SIGINT", () => {
    watcher.close().then(() => {
      log.cli("Watch mode terminated");
      process.exit(0);
    });
  });
}

// Parse command line arguments
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
