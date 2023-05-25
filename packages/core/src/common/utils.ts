import { createHash } from "crypto";
import { readFileSync } from "fs";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export const ensureDirExists = (filePath: string) => {
  const dirname = path.dirname(filePath);
  if (existsSync(dirname)) {
    return;
  }
  mkdirSync(dirname, { recursive: true });
};

export const registerKilledProcessListener = (fn: () => Promise<unknown>) => {
  let isKillListenerInProgress = false;

  const listener = async () => {
    if (isKillListenerInProgress) return;
    isKillListenerInProgress = true;
    await fn();
    process.exit(0);
  };

  process.on("SIGINT", listener); // CTRL+C
  process.on("SIGQUIT", listener); // Keyboard quit
  process.on("SIGTERM", listener); // `kill` command
};

export const startBenchmark = () => process.hrtime();
export const endBenchmark = (hrt: [number, number]) => {
  const diffHrt = process.hrtime(hrt);
  return Math.round(diffHrt[0] * 1000 + diffHrt[1] / 1000000);
};

export const formatEta = (ms: number) => {
  // If less than 1 second, return ms.
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.floor(ms / 1000);

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds - h * 3600) / 60);
  const s = seconds - h * 3600 - m * 60;

  const hstr = h > 0 ? `${h}h ` : "";
  const mstr = m > 0 || h > 0 ? `${m}m ` : "";
  const sstr = s > 0 || m > 0 ? `${s}s` : "";

  return `${hstr}${mstr}${sstr}`;
};

export const formatPercentage = (cacheRate: number) => {
  const decimal = Math.round(cacheRate * 1000) / 10;
  return Number.isInteger(decimal) && decimal < 100
    ? `${decimal}.0%`
    : `${decimal}%`;
};

const latestFileHash: Record<string, string | undefined> = {};

export const isFileChanged = (filePath: string) => {
  // TODO: I think this throws if the file being watched gets deleted while
  // the development server is running. Should handle this case gracefully.
  try {
    const content = readFileSync(filePath, "utf-8");
    const hash = createHash("md5").update(content).digest("hex");

    const prevHash = latestFileHash[filePath];
    latestFileHash[filePath] = hash;
    if (!prevHash) {
      // If there is no previous hash, this file is being changed for the first time.
      return true;
    } else {
      // If there is a previous hash, check if the content hash has changed.
      return prevHash !== hash;
    }
  } catch (e) {
    return true;
  }
};
