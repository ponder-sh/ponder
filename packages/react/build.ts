/// <reference types="node" />

import chalk from "chalk";
import { execa } from "execa";
import { rimraf } from "rimraf";

const PACKAGE_NAME = "@PONDER/REACT";
const TSCONFIG = "tsconfig.build.json";

const prefix = `${chalk.gray("[")}${PACKAGE_NAME}${chalk.gray("]")}`;
const cliInfo = `${prefix} ${chalk.blue("CLI")}`;
const cliError = `${prefix} ${chalk.red("CLI")}`;
const tscInfo = `${prefix} ${chalk.green("TSC")}`;
const tscError = `${prefix} ${chalk.red("TSC")}`;

async function build() {
  console.log(`${cliInfo} Build start`);

  const startTime = Date.now();

  // Clean dist folder
  try {
    await rimraf("dist");
    console.log(`${cliInfo} Cleaned output folder`);
  } catch (error) {
    console.error(`${cliError} Clean failed:`);
    console.error(error);
    return false;
  }

  // Run TypeScript compiler
  let stdout: string;
  let stderr: string;
  let exitCode: number;
  try {
    const result = await execa("tsc", ["--project", TSCONFIG], {
      reject: false,
      stderr: "pipe",
      stdout: "pipe",
    });
    stdout = result.stdout;
    stderr = result.stderr;
    exitCode = result.exitCode;
  } catch (error) {
    console.error(error);
    console.error(`${tscError} Build failed`);
    return false;
  }

  const output = `${stdout}\n${stderr}`
    .trim()
    .split("\n")
    .filter((l) => l.trim() !== "");
  for (const line of output) {
    console.log(`${tscError} ${line}`);
  }

  if (exitCode !== 0) {
    console.error(`${tscError} Build failed`);
    return false;
  }

  const duration = Date.now() - startTime;
  console.log(`${tscInfo} ⚡️ Build success in ${duration}ms`);

  return true;
}

build().then((success) => {
  process.exit(success ? 0 : 1);
});

/// WATCH MODE (WIP) ///

// async function watchMode() {
//   // Initial build
//   await build();

//   const paths = ["."];
//   const ignorePaths = ["**/node_modules/**", "**/dist/**", "**/.git/**"];

//   // Set up file watcher
//   const watcher = watch(paths, {
//     ignored: ignorePaths,
//     persistent: true,
//     ignoreInitial: true,
//     awaitWriteFinish: {
//       stabilityThreshold: 100,
//       pollInterval: 100,
//     },
//   });

//   console.log(
//     `${cliInfo} Watching for changes in ${paths.map((p) => `"${p}"`).join(" | ")}`,
//   );
//   console.log(
//     `${cliInfo} Ignoring changes in ${ignorePaths
//       .map((p) => `"${p}"`)
//       .join(" | ")}`,
//   );

//   let building = false;
//   let pendingBuild = false;

//   watcher
//     .on("change", async (path) => {
//       console.log(`${cliInfo} Change detected: ${path}`);

//       if (building) {
//         pendingBuild = true;
//         return;
//       }

//       building = true;
//       await build();
//       building = false;

//       if (pendingBuild) {
//         pendingBuild = false;
//         watcher.emit("change", "pending changes");
//       }
//     })
//     .on("error", (error) => {
//       console.log(`${cliError} Watch error:`);
//       console.error(error);
//     });
// }

// // Check for watch mode in a more robust way
// const isWatchMode = process.argv
//   .slice(2)
//   .some((arg) => arg === "--watch" || arg === "--watch=true" || arg === "-w");

// if (isWatchMode) {
//   watchMode().catch((error) => {
//     console.log(`${cliError} Watch mode failed:`);
//     console.error(error);
//     process.exit(1);
//   });
// } else {
//   build().then((success) => {
//     process.exit(success ? 0 : 1);
//   });
// }
