import execa from "execa";
import parsePrometheusTextFormat from "parse-prometheus-text-format";
import { beforeAll, test } from "vitest";

async function fetchWithTimeout(
  input: RequestInfo | URL,
  options: RequestInit & { timeout?: number } = {}
) {
  const { timeout = 2_000 } = options;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  const response = await fetch(input, {
    ...options,
    signal: controller.signal,
  });
  clearTimeout(id);

  return response;
}

const fetchGraphql = async (query: string) => {
  const response = await fetchWithTimeout(
    "http://localhost:8000/subgraphs/name/ponder-benchmarks/subgraph",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: `query { ${query} }` }),
    }
  );
  const body = await response.json();
  return body;
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

  let graphqlError = "initial";
  while (graphqlError) {
    console.log("Fetching latest block number...");
    const response = await fetchGraphql(`
    _meta {
      block {
        number
      }
    }
  `);

    graphqlError = response.errors?.[0];
    if (graphqlError) {
      console.log("Got GraphQL error:", graphqlError);
    } else {
      const blockNumber = response.data?._meta?.block?.number;
      console.log("Got block number:", blockNumber);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  const response = await fetchGraphql(`
    _meta {
      block {
        number
      }
    }
  `);

  const error = response.errors?.[0];
  if (error) {
    console.log("GraphQL error:", error);
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
