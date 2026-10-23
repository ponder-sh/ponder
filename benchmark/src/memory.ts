import { readFileSync } from "node:fs";
import v8 from "node:v8";
import { runInNewContext } from "node:vm";

declare const Bun:
  | { gc: (force: boolean) => void; version: string }
  | undefined;

const MiB = 1024 * 1024;

export const runtime =
  typeof Bun !== "undefined"
    ? { name: "bun", version: Bun.version }
    : { name: "node", version: process.versions.node };

export type MemoryReading = {
  /** Milliseconds since the monitor was created. */
  t: number;
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
};

const round = (value: number) => Math.round(value * 10) / 10;

const toMiB = (bytes: number) => round(bytes / MiB);

/**
 * Returns a function that forces a full, synchronous garbage collection.
 *
 * Node exposes `global.gc()` with `--expose-gc`. When the flag is missing,
 * the flag is enabled at runtime and `gc` is read from a fresh context.
 */
const getGc = (): (() => void) => {
  if (typeof Bun !== "undefined") return () => Bun!.gc(true);
  if (typeof globalThis.gc === "function") return globalThis.gc as () => void;
  v8.setFlagsFromString("--expose-gc");
  return runInNewContext("gc") as () => void;
};

export const gc = getGc();

export const heapLimitMiB = toMiB(v8.getHeapStatistics().heap_size_limit);

const read = (start: number): MemoryReading => {
  const usage = process.memoryUsage();
  return {
    t: Math.round(performance.now() - start),
    rss: toMiB(usage.rss),
    heapUsed: toMiB(usage.heapUsed),
    heapTotal: toMiB(usage.heapTotal),
    external: toMiB(usage.external),
    arrayBuffers: toMiB(usage.arrayBuffers),
  };
};

/** Peak resident set size in MiB (high-water mark, catches spikes between samples). */
export const peakRssMiB = () => {
  // `maxRSS` is reported in KiB.
  const maxRss = toMiB(process.resourceUsage().maxRSS * 1024);
  let vmHwm: number | undefined;
  try {
    const match = readFileSync("/proc/self/status", "utf8").match(
      /^VmHWM:\s+(\d+)\s+kB$/m,
    );
    if (match) vmHwm = toMiB(Number(match[1]) * 1024);
  } catch {}
  return vmHwm === undefined ? maxRss : Math.max(maxRss, vmHwm);
};

export const formatReading = (phase: string, reading: MemoryReading) =>
  `[memory] phase=${phase} t=${Math.round(reading.t / 1000)}s rss=${reading.rss}MiB heapUsed=${reading.heapUsed}MiB heapTotal=${reading.heapTotal}MiB heapLimit=${heapLimitMiB}MiB external=${reading.external}MiB arrayBuffers=${reading.arrayBuffers}MiB`;

/**
 * Samples memory without forcing GC on a fixed interval to track peaks,
 * and takes post-GC readings on demand for cross-commit comparisons.
 */
export const createMemoryMonitor = ({
  sampleIntervalMs,
}: {
  sampleIntervalMs: number;
}) => {
  const start = performance.now();
  const peak: Omit<MemoryReading, "t"> = {
    rss: 0,
    heapUsed: 0,
    heapTotal: 0,
    external: 0,
    arrayBuffers: 0,
  };
  let sampleCount = 0;

  const sample = () => {
    const reading = read(start);
    sampleCount++;
    for (const key of Object.keys(peak) as (keyof typeof peak)[]) {
      peak[key] = Math.max(peak[key], reading[key]);
    }
    return reading;
  };

  const interval = setInterval(sample, sampleIntervalMs);
  interval.unref();

  return {
    /** Forces a full GC immediately before reading memory. */
    readAfterGc: (): MemoryReading => {
      gc();
      return sample();
    },
    stop: () => clearInterval(interval),
    /** Highest values observed by the periodic (non-GC) samples. */
    peak: () => ({ ...peak, samples: sampleCount }),
  };
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** Least-squares slope in MiB per hour. */
const slopePerHour = (points: { t: number; value: number }[]) => {
  if (points.length < 2) return 0;
  const xs = points.map((p) => p.t / 3_600_000);
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = points.reduce((a, p) => a + p.value, 0) / points.length;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < points.length; i++) {
    numerator += (xs[i]! - meanX) * (points[i]!.value - meanY);
    denominator += (xs[i]! - meanX) ** 2;
  }
  return denominator === 0 ? 0 : numerator / denominator;
};

export const summarize = (
  readings: MemoryReading[],
  key: "heapUsed" | "rss",
) => {
  const values = readings.map((r) => r[key]);
  return {
    min: Math.min(...values),
    median: round(median(values)),
    max: Math.max(...values),
    last: values[values.length - 1]!,
    slopeMiBPerHour: round(
      slopePerHour(readings.map((r) => ({ t: r.t, value: r[key] }))),
    ),
  };
};
