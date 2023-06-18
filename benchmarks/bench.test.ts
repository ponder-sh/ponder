import execa from "execa";
import parsePrometheusTextFormat from "parse-prometheus-text-format";
import { beforeAll, test } from "vitest";

import { FORK_BLOCK_NUMBER } from "./_test/constants";

const END_BLOCK = FORK_BLOCK_NUMBER;

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

beforeAll(async () => {
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

  const endClock = startClock();

  await new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      const latestBlockNumber = await fetchSubgraphLatestBlockNumber();
      if (latestBlockNumber >= END_BLOCK) {
        clearInterval(interval);
        resolve(undefined);
      }
    }, 1_000);

    setTimeout(() => {
      clearInterval(interval);
      reject(new Error("Timed out waiting for subgraph to sync"));
    }, 60_000);
  });

  const duration = endClock();

  console.log("Subgraph synced in", duration, "ms");

  const metricsResponse = await fetchWithTimeout("http://localhost:8040");
  const metricsRaw = await metricsResponse.text();
  const metrics = parsePrometheusTextFormat(metricsRaw) as any[];

  const chain_head_cache_num_blocks =
    metrics.find((m) => m.name === "chain_head_cache_num_blocks")?.metrics ??
    [];

  const endpoint_request: { req_type: string; result: string }[] =
    metrics.find((m) => m.name === "endpoint_request")?.metrics ?? [];

  console.log({ chain_head_cache_num_blocks, endpoint_request });

  console.log(metricsRaw);
  for (const metric of metrics) {
    console.log(metric);
  }
}, 120_000);

test("test", async () => {
  console.log("In test!");
});
