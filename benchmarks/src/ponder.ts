import execa from "execa";

import { fetchWithTimeout, parsePrometheusText, startClock } from "./utils";

const END_BLOCK_TIMESTAMP = 1687010591; // unix timestamp at end block

const fetchPonderMetrics = async () => {
  try {
    const metricsResponse = await fetchWithTimeout(
      "http://localhost:42069/metrics"
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
      reject(new Error("Timed out waiting for subgraph to sync"));
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
          (m) => m.name === "ponder_indexing_latest_processed_timestamp"
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
      reject(new Error("Timed out waiting for subgraph to sync"));
    }, 60_000);
  });

  return duration;
};

export const ponder = async () => {
  console.log("Creating Ponder instance...");
  const subprocess = execa("ponder", ["start", `--root-dir=ponder`], {
    stdio: "inherit",
    detached: true,
  });

  const setupDuration = await waitForSetupComplete();
  const duration = await waitForSyncComplete();

  subprocess.kill();

  return { setupDuration, duration };
};
