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

export const groupBy = <T>(array: T[], fn: (item: T) => string | number) => {
  return array.reduce<{ [k: string | number]: T[] }>((acc, item) => {
    const key = fn(item);
    (acc[key] = acc[key] || []).push(item);
    return acc;
  }, {});
};

export const registerKilledProcessListener = (fn: () => Promise<unknown>) => {
  let calledCount = 0;

  const listener = async () => {
    calledCount++;
    if (calledCount > 1) return;
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

// These methods are used in the cached interval calculations
// From https://stackoverflow.com/a/33857786/12841788

/* This method is just a small helper method that takes an array
 * and returns a new array with duplicates removed
 */
function remove_duplicates(arr: number[][]) {
  const lookup: Record<string, number> = {};
  const results = [];
  for (let i = 0; i < arr.length; i++) {
    const el = arr[i];
    const key = el.toString();
    if (lookup[key]) continue;
    lookup[key] = 1;
    results.push(el);
  }
  return results;
}

/* This method takes 2 points p1 and p2 and returns an array of
 * points with the range of p2 removed, i.e. p1 = [1,7]
 * p2 = [4,5] returned = [[1,3],[6,7]]
 */
export function p1_excluding_p2(p1: number[], p2: number[]) {
  if (p1[1] < p2[0]) return [p1]; // line p1 finishes before the exclusion line p2
  if (p1[0] > p2[1]) return [p1]; // line p1 starts after exclusion line p1
  const lines = [];
  // calculate p1 before p2 starts
  const line1 = [p1[0], Math.min(p1[1], p2[0] - 1)];
  if (line1[0] <= line1[1]) lines.push(line1);
  // calculate p1 after p2 ends
  const line2 = [p2[1] + 1, p1[1]];
  if (line2[0] <= line2[1]) lines.push(line2);
  // these contain the lines we calculated above
  return lines;
}

/* this performs the exact same operation as above, only it allows you to pass
 * multiple points (but still just 1 exclusion point) and returns results
 * in an identical format as above, i.e. points = [[1,7],[0,1]]
 *  p2 = [4,5] returned = [[0,1],[1,3],[6,7]]
 */
function points_excluding_p2(points: number[][], p2: number[]) {
  const results: number[][] = [];
  for (let i = 0; i < points.length; i++) {
    const lines = p1_excluding_p2(points[i], p2);
    results.push(...lines);
  }
  return results;
}

/* this method performs the same operation only this time it takes one point
 * and multiple exclusion points and returns an array of the results.
 * this is the important method of: given 1 point and many
 * exclusion points, return the remaining new ranges
 */
export function p1_excluding_all(p1: number[], exclude: number[][]) {
  let checking = [p1];
  for (let i = 0; i < exclude.length; i++) {
    checking = points_excluding_p2(checking, exclude[i]);
  }
  return remove_duplicates(checking);
}

/* This function merges intervals (inclusive on both ends).
 * I modified the SO impl to handle [inclusive, inclusive] intervals.
 * From: https://stackoverflow.com/a/26391774/12841788
 */
export function merge_intervals(intervals: number[][]) {
  intervals.sort((a, b) => a[0] - b[0]);
  const result: number[][] = [];
  let last: number[];
  intervals.forEach((interval) => {
    if (interval[1] < interval[0])
      throw new Error(`Cannot merge invalid interval: ${interval}`);
    interval = [interval[0], interval[1] + 1];
    if (!last || interval[0] > last[1]) {
      result.push((last = interval));
    } else if (interval[1] > last[1]) {
      last[1] = interval[1];
    }
  });
  return result.map((r) => [r[0], r[1] - 1]);
}
