import execa from "execa";
import parsePrometheusTextFormat from "parse-prometheus-text-format";

import { FORK_BLOCK_NUMBER } from "./constants";

const START_BLOCK = 17500000;
const END_BLOCK = Number(FORK_BLOCK_NUMBER);

export const startClock = () => {
  const start = process.hrtime();

  return () => {
    const diff = process.hrtime(start);
    return Math.round(diff[0] * 1000 + diff[1] / 1000000);
  };
};

const fetchWithTimeout = async (
  input: RequestInfo | URL,
  options: RequestInit & { timeout?: number } = {}
) => {
  const { timeout = 2_000 } = options;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  const response = await fetch(input, {
    ...options,
    signal: controller.signal,
  });
  clearTimeout(id);

  return response;
};

const fetchGraphql = async (input: RequestInfo | URL, query: string) => {
  const response = await fetchWithTimeout(input, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: `query ${query}` }),
  });
  const body = await response.json();
  return body;
};

const fetchSubgraphLatestBlockNumber = async () => {
  const response = await fetchGraphql(
    "http://localhost:8000/subgraphs/name/ponder-benchmarks/subgraph",
    `{
      _meta {
        block {
          number
        }
      }
    }`
  );

  const error = response.errors?.[0];

  if (error) {
    if (
      error.message?.endsWith(
        "Wait for it to ingest a few blocks before querying it"
      )
    ) {
      return 0;
    } else {
      throw error;
    }
  }

  const blockNumber = response.data?._meta?.block?.number;

  return blockNumber as number;
};

const fetchSubgraphMetrics = async () => {
  const metricsResponse = await fetchWithTimeout("http://localhost:8040");
  const metricsRaw = await metricsResponse.text();
  const metrics = parsePrometheusTextFormat(metricsRaw) as any[];
  return metrics;
};

const subgraph = async () => {
  console.log("Registering subgraph...");
  await execa(
    "graph",
    ["create", "ponder-benchmarks/subgraph", "--node=http://localhost:8020"],
    {
      timeout: 10_000,
      stdio: "inherit",
    }
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
    }
  );

  const endClockGraphQL = startClock();
  const endClockMetrics = startClock();
  let durationGraphQL = -1;
  let durationMetrics = -1;

  await Promise.all([
    new Promise((resolve, reject) => {
      const interval = setInterval(async () => {
        const latestBlockNumber = await fetchSubgraphLatestBlockNumber();
        if (latestBlockNumber >= END_BLOCK - START_BLOCK) {
          durationGraphQL = endClockGraphQL();
          clearInterval(interval);
          resolve(undefined);
        }
      }, 1_000);

      setTimeout(() => {
        clearInterval(interval);
        reject(new Error("Timed out waiting for subgraph to sync"));
      }, 60_000);
    }),
    new Promise((resolve, reject) => {
      const interval = setInterval(async () => {
        const metrics = await fetchSubgraphMetrics();

        const chain_head_cache_num_blocks = Number(
          metrics
            .find((m) => m.name === "chain_head_cache_num_blocks")
            ?.metrics.find((m) => m?.labels?.network === "mainnet").value
        );

        if (chain_head_cache_num_blocks >= 10) {
          durationMetrics = endClockMetrics();
          clearInterval(interval);
          resolve(undefined);
        }
      }, 1_000);

      setTimeout(() => {
        clearInterval(interval);
        reject(new Error("Timed out waiting for subgraph to sync"));
      }, 60_000);
    }),
  ]);

  console.log("Subgraph synced in:", { durationGraphQL, durationMetrics });

  const metrics = await fetchSubgraphMetrics();

  const endpoint_request = metrics
    .find((m) => m.name === "endpoint_request")
    ?.metrics.map(({ value, labels }) => ({
      method: labels.req_type,
      value: Number(value),
    }));

  console.log(endpoint_request);

  for (const metric of metrics) {
    console.log(metric.name);
    console.log(metric.help);
    console.log(metric.type);
    console.log(metric.metrics);
    console.log("");
  }
};

await subgraph();
