import { rmSync } from "node:fs";
import os from "node:os";

import { execa } from "execa";

import { fetchWithTimeout, parsePrometheusText, startClock } from "./utils";

const END_BLOCK_TIMESTAMP = 1687010591; // unix timestamp at end block

const fetchPonderMetrics = async () => {
  try {
    const metricsResponse = await fetchWithTimeout(
      "http://localhost:42069/metrics",
    );
    const metricsRaw = await metricsResponse.text();
    const metrics = parsePrometheusText(metricsRaw);
    return metrics;
  } catch (err) {
    return [];
  }
};

const waitForSetupComplete = async () => {
  const endClock = startClock();
  let duration: number;
  await new Promise((resolve, reject) => {
    let timeout = undefined;
    const interval = setInterval(async () => {
      const metrics = await fetchPonderMetrics();

      if (metrics.length !== 0) {
        duration = endClock();
        clearInterval(interval);
        clearTimeout(timeout);
        resolve(undefined);
      }
    }, 50);

    timeout = setTimeout(() => {
      clearInterval(interval);
      reject(new Error("Timed out waiting for ponder to sync"));
    }, 60_000);
  });

  return duration;
};

const waitForSyncComplete = async () => {
  const endClock = startClock();
  let duration: number;
  await new Promise((resolve, reject) => {
    let timeout = undefined;
    const interval = setInterval(async () => {
      const metrics = await fetchPonderMetrics();
      const latestProcessedTimestamp =
        metrics.find(
          (m) => m.name === "ponder_indexing_latest_processed_timestamp",
        )?.metrics[0].value ?? 0;

      if (latestProcessedTimestamp >= END_BLOCK_TIMESTAMP) {
        duration = endClock();
        clearInterval(interval);
        clearTimeout(timeout);
        resolve(undefined);
      }
    }, 50);

    timeout = setTimeout(() => {
      clearInterval(interval);
      reject(new Error("Timed out waiting for ponder to sync"));
    }, 180_000);
  });

  return duration;
};

const ponder = async () => {
  console.log("Creating Ponder instance...");

  const subprocess = execa(
    "../packages/core/dist/bin/ponder.js",
    ["start", `--root-dir=ponder`],
    {
      stdio: "inherit",
      detached: true,
    },
  );

  const setupDuration = await waitForSetupComplete();
  const duration = await waitForSyncComplete();

  const metrics = await fetchPonderMetrics();

  const rpcRequest = metrics.find(
    (m) => m.name === "ponder_historical_rpc_request_duration",
  )?.metrics[0]?.buckets["+Inf"];

  subprocess.kill();

  return { setupDuration, duration, rpcRequest };
};

const bench = async () => {
  rmSync("./ponder/.ponder/", {
    recursive: true,
    force: true,
  });
  rmSync("./ponder/generated/", {
    recursive: true,
    force: true,
  });

  const ponderCold = await ponder();
  const ponderHot = await ponder();

  console.log({ ponderHot, ponderCold });

  console.log(os.cpus(), os.platform(), os.machine());
};

await bench();
