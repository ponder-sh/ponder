import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { watch } from "chokidar";
import { execa } from "execa";
import { glob } from "glob";
import pc from "picocolors";
import { rimraf } from "rimraf";

const PACKAGE_NAME = "@PONDER/REACT";

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
