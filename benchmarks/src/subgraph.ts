import execa from "execa";
import parsePrometheusTextFormat from "parse-prometheus-text-format";

import { fetchGraphql, fetchWithTimeout, startClock } from "./utils";

const END_BLOCK = Number(process.env.ANVIL_FORK_BLOCK_NUMBER);

const fetchSubgraphLatestBlockNumber = async () => {
  try {
    const response = await fetchGraphql(
      "http://localhost:8000/subgraphs/name/ponder-benchmarks/subgraph",
      `{
        _meta {
          block {
            number
          }
        }
      }`,
    );

    const error = response.errors?.[0];

    if (error) {
      if (
        error.message?.endsWith(
          "Wait for it to ingest a few blocks before querying it",
        )
      ) {
        return 0;
      } else {
        throw error;
      }
    }

    const blockNumber = response.data?._meta?.block?.number;

    return blockNumber as number;
  } catch (err) {
    return 0;
  }
};

const fetchSubgraphMetrics = async () => {
  const metricsResponse = await fetchWithTimeout("http://localhost:8040");
  const metricsRaw = await metricsResponse.text();
  const metrics = parsePrometheusTextFormat(metricsRaw) as any[];
  return metrics;
};

const waitForGraphNode = async () => {
  const endClock = startClock();
  return new Promise<number>((resolve, reject) => {
    let timeout = undefined;
    const interval = setInterval(async () => {
      try {
        const metrics = await fetchSubgraphMetrics();
        if (metrics) {
          clearInterval(interval);
          clearTimeout(timeout);
          resolve(endClock());
        }
      } catch (e) {
        // Ignore.
      }
    }, 1_000);

    timeout = setTimeout(() => {
      clearInterval(interval);
      reject(new Error("Timed out waiting for Graph Node to start"));
    }, 30_000);
  });
};

const waitForSyncComplete = async () => {
  const endClock = startClock();
  let duration: number;

  await new Promise((resolve, reject) => {
    let timeout = undefined;
    const interval = setInterval(async () => {
      const latestSyncedBlockNumber = await fetchSubgraphLatestBlockNumber();
      console.log(
        `Latest synced block number: ${latestSyncedBlockNumber}/${END_BLOCK}`,
      );

      if (latestSyncedBlockNumber >= END_BLOCK) {
        duration = endClock();
        clearInterval(interval);
        clearTimeout(timeout);
        resolve(undefined);
      }
    }, 1_000);

    timeout = setTimeout(() => {
      clearInterval(interval);
      reject(new Error("Timed out waiting for subgraph to sync"));
    }, 60_000);
  });

  return duration;
};

export const subgraph = async () => {
  console.log(`Waiting for Graph Node to be ready...`);
  const setupDuration = await waitForGraphNode();

  console.log("Registering subgraph...");
  await execa(
    "graph",
    ["create", "ponder-benchmarks/subgraph", "--node=http://localhost:8020"],
    {
      timeout: 10_000,
      stdio: "inherit",
    },
  );

  console.log("Deploying subgraph...");
  await execa(
    "graph",
    [
      "deploy",
      "ponder-benchmarks/subgraph",
      "./subgraph/subgraph.yaml",
      "--output-dir=./subgraph/build",
      "--ipfs=http://localhost:5001",
      "--node=http://localhost:8020",
      "--version-label=v0.0.1",
    ],
    {
      timeout: 10_000,
      stdio: "inherit",
    },
  );

  const duration = await waitForSyncComplete();

  return { setupDuration, duration };
};
