import { rmSync } from "node:fs";
import os from "node:os";

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

const fetchPonderGraphql = async () => {
  try {
    const graphqlResponse = await fetchWithTimeout(
      "http://localhost:42069/graphql",
    );
    try {
      JSON.parse(await graphqlResponse.text());
      return false;
    } catch (err) {
      return true;
    }
  } catch (err) {
    return false;
  }
};

const waitForSetupComplete = async () => {
  const endClock = startClock();
  let duration: number = 0;
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
  let duration: number = 0;
  await new Promise((resolve) => {
    const interval = setInterval(async () => {
      if (await fetchPonderGraphql()) {
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
    ["start", `--root-dir=ponder`],
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
