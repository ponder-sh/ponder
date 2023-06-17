import execa from "execa";
import parsePrometheusTextFormat from "parse-prometheus-text-format";
import { beforeAll, test } from "vitest";

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
  // Need to exec the `graph create` and `graph deploy` commands here.
  // This setup should not be part of the benchmark.

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

  console.log("Waiting for subgraph to sync 100 blocks...");
  let latestBlockNumber = 0;
  while (latestBlockNumber < 17500100) {
    latestBlockNumber = await fetchSubgraphLatestBlockNumber();
    console.log({ latestBlockNumber });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  console.log("Fetching Graph Node metrics...");
  try {
    const metricsResponse = await fetchWithTimeout("http://localhost:8040");
    const metricsRaw = await metricsResponse.text();
    const metrics = parsePrometheusTextFormat(metricsRaw);
    console.log({ metrics });
  } catch (error) {
    console.log("Unable to fetch metrics:", { error });
  }
}, 60_000);

test("test", async () => {
  console.log("In test!");
});
