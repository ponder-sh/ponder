import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { execa } from "execa";

import { fetchWithTimeout, startClock } from "./utils";

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

const fetchHealth = async () => {
  const healthResponse = await fetchWithTimeout(
    "http://localhost:42069/health",
  );

  if (healthResponse.status === 200) return true;
  return false;
};

const waitForSetupComplete = async () => {
  const endClock = startClock();
  let duration = 0;
  await new Promise((resolve, reject) => {
    let timeout: undefined | NodeJS.Timeout = undefined;
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
      reject(new Error("Timed out waiting for ponder to setup"));
    }, 60_000);
  });

  return duration;
};

const waitForSyncComplete = async () => {
  const endClock = startClock();
  let duration = 0;
  await new Promise((resolve) => {
    const interval = setInterval(async () => {
      if (await fetchHealth()) {
        duration = endClock();
        clearInterval(interval);
        resolve(undefined);
      }
    }, 100);
  });

  return duration;
};

const ponder = async () => {
  console.log("Creating Ponder instance...");

  const subprocess = execa(
    "../packages/core/dist/bin/ponder.js",
    ["start", `--root=${process.argv[2]}`],
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
  // rmSync(path.join(process.argv[2]!, ".ponder"), {
  //   recursive: true,
  //   force: true,
  // });
  // rmSync(path.join(process.argv[2]!, "generated"), {
  //   recursive: true,
  //   force: true,
  // });

  const ponderCold = await ponder();
  const ponderHot = await ponder();

  console.log({ ponderHot, ponderCold });
};

await bench();
