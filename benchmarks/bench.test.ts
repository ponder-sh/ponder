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

  const fetchGraphql = async (query: string) => {
    const response = await fetchWithTimeout(
      "http://localhost:8000/subgraphs/name/ponder-benchmarks/subgraph/graphql",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: `query { ${query} }` }),
      }
    );
    const body = await response.text();
    return body;
  };

  try {
    const response = await fetchGraphql(`
      exampleEntitys {
        id
      }
    `);

    console.log({ response });
  } catch (error8000) {
    console.log({ error8000 });
  }

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
