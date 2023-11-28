import { rmSync } from "node:fs";
import os from "node:os";

import { execa } from "execa";

import { fetchWithTimeout, parsePrometheusText, startClock } from "./utils";

const fetchPonderMetrics = async () => {
  try {
    const metricsResponse = await fetchWithTimeout(
      "http://localhost:42069/metrics",
    );
    const metricsRaw = await metricsResponse.text();
    return metricsRaw.split("\n");
  } catch (err) {
    return [];
  }
};

const fetchPonderGraphql = async () => {
  try {
    const graphqlResponse = await fetchWithTimeout(
      "http://localhost:42069/graphql",
    );
    const graphql = JSON.parse(await graphqlResponse.text());
    return !("errors" in graphql);
  } catch (err) {
    return false;
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
      // const metrics = await fetchPonderMetrics();
      console.log(await fetchPonderGraphql());
      // const latestProcessedTimestamp = Number(
      //   metrics
      //     .filter((m) =>
      //       m.includes("ponder_indexing_latest_processed_timestamp"),
      //     )[2]
      //     .slice(42),
      // );

      // if (latestProcessedTimestamp >= END_BLOCK_TIMESTAMP) {
      //   duration = endClock();
      //   clearInterval(interval);
      //   clearTimeout(timeout);
      //   resolve(undefined);
      // }
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
    ["dev", `--root-dir=ponder`],
    {
      stdio: "inherit",
      detached: true,
    },
  );

  const setupDuration = await waitForSetupComplete();
  const duration = await waitForSyncComplete();

  const metrics = (await fetchPonderMetrics()).filter((m) =>
    m.includes("ponder_historical_rpc_request_duration"),
  );
  subprocess.kill();

  return { setupDuration, duration, metrics };
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
