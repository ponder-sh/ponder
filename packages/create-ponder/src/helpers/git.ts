/* eslint-disable no-empty */
import { execSync } from "child_process";
import path from "path";
import { rimraf } from "rimraf";

// File adapted from next.js
// https://github.dev/vercel/next.js/blob/9ad1f321b7902542acd2be041fb2f15f023a0ed9/packages/create-next-app/helpers/git.ts

function isInGitRepository(): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", { stdio: "ignore" });
    return true;
  } catch (_) {}
  return false;
}

function isInMercurialRepository(): boolean {
  try {
    execSync("hg --cwd . root", { stdio: "ignore" });
    return true;
  } catch (_) {}
  return false;
}

export function tryGitInit(root: string): boolean {
  let didInit = false;
  try {
    execSync("git --version", { stdio: "ignore" });
    if (isInGitRepository() || isInMercurialRepository()) {
      return false;
    }

    execSync("git init", { stdio: "ignore" });
    didInit = true;

    execSync("git checkout -b main", { stdio: "ignore" });

    execSync("git add -A", { stdio: "ignore" });
    execSync('git commit -m "chore: initial commit from create-ponder"', {
      stdio: "ignore",
    });
    return true;
  } catch (e) {
    if (didInit) {
      try {
        rimraf.sync(path.join(root, ".git"));
      } catch (_) {}
    }
    return false;
  }
}
